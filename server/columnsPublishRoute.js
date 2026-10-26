const crypto = require("crypto");
const supabaseEnv = require("../services/supabase/env");

/**
 * KÖŞE YAZISI YAYIN UÇ NOKTASI.
 *
 *   POST /api/columns-publish  → Supabase `columns` tablosuna yeni satır ekler.
 *
 * Yetki: `Authorization: Bearer <EDITOR_TOKEN>` (sabit-zamanlı karşılaştırma).
 * Service role anahtarı yalnızca sunucuda, `services/supabase/env.js`ten
 * okunur; hiçbir yanıtta ya da log satırında yer almaz.
 *
 * Durum kodları: 200 eklenen satır · 400 geçersiz gövde · 401 yetkisiz ·
 * 405 yöntem · 409 slug zaten var · 502 Supabase hatası · 503 yapılandırma eksik.
 */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_PREFIXES = ["https://www.futbolradar.com/", "https://futbolradar.com/"];
const LIMITS = { slug: 160, title: 200, excerpt: 600, url: 400 };
const UPSTREAM_TIMEOUT_MS = 8000;

function tokensMatch(expected, provided) {
  if (!expected || !provided) return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(req) {
  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
  const match = String(Array.isArray(header) ? header[0] : header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (error) { return null; }
  }
  if (typeof req.on !== "function") return null;
  const raw = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 16384) { data = ""; resolve(null); }
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(null));
  });
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (error) { return null; }
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "JSON gövdesi gerekli." };
  const out = {};
  for (const field of ["slug", "title", "excerpt", "url"]) {
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    if (!value) return { error: `${field} alanı zorunlu.` };
    if (value.length > LIMITS[field]) return { error: `${field} en fazla ${LIMITS[field]} karakter olabilir.` };
    out[field] = value;
  }
  if (!SLUG_RE.test(out.slug)) return { error: "slug küçük harf, rakam ve tire (kebab-case) olmalı." };
  if (!URL_PREFIXES.some((prefix) => out.url.startsWith(prefix)) || /\s/.test(out.url)) {
    return { error: "url https://www.futbolradar.com/ veya https://futbolradar.com/ ile başlamalı." };
  }
  return { value: out };
}

function sendJson(res, status, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (typeof res.status === "function" && typeof res.json === "function") return res.status(status).json(payload);
  res.statusCode = status;
  return res.end(JSON.stringify(payload));
}

function fail(res, status, code, message) {
  return sendJson(res, status, { ok: false, error: { code, message } });
}

async function handleColumnsPublish(req, res) {
  if (String(req.method || "").toUpperCase() !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "METHOD_NOT_ALLOWED", "Sadece POST desteklenir.");
  }

  const editorToken = String(process.env.EDITOR_TOKEN || "").trim();
  const restUrl = supabaseEnv.restUrl();
  const serviceKey = supabaseEnv.serviceKey();
  if (!editorToken || !restUrl || !serviceKey) {
    return fail(res, 503, "NOT_CONFIGURED", "Yayın uç noktası yapılandırılmamış.");
  }

  if (!tokensMatch(editorToken, bearerToken(req))) {
    return fail(res, 401, "UNAUTHORIZED", "Yetkisiz.");
  }

  const checked = validate(await readJsonBody(req));
  if (checked.error) return fail(res, 400, "INVALID_BODY", checked.error);

  const row = { ...checked.value, published_at: new Date().toISOString() };
  let response;
  try {
    response = await fetch(`${restUrl}/rest/v1/columns`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (error) {
    return fail(res, 502, "UPSTREAM_ERROR", "Supabase'e ulaşılamadı.");
  }

  let payload = null;
  try { payload = await response.json(); } catch (error) { payload = null; }

  if (response.status === 409 || (payload && payload.code === "23505")) {
    return fail(res, 409, "SLUG_CONFLICT", "Bu slug ile bir yazı zaten var.");
  }
  if (!response.ok) {
    return fail(res, 502, "UPSTREAM_ERROR", `Supabase hatası (${response.status}).`);
  }
  const inserted = Array.isArray(payload) ? payload[0] : payload;
  return sendJson(res, 200, { ok: true, data: inserted || null });
}

module.exports = { handleColumnsPublish, validate, tokensMatch };
