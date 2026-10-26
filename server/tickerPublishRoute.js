const supabaseEnv = require("../services/supabase/env");
const { tokensMatch } = require("./columnsPublishRoute");
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");

/**
 * TRANSFER GÜNDEMİ KAYAN YAZISI YAYIN UÇ NOKTASI.
 *
 *   POST /api/ticker-publish  → Supabase `transfer_ticker` tablosunu yeniler.
 *
 * Gövde: { items: [{ text, status, league, source_name, source_url }], replace: true }
 * replace=true ise önce aktif satırların expires_at'i şimdiye çekilir, sonra
 * yeni satırlar expires_at = şimdi + 48 saat ile eklenir. Böylece bot günde
 * bir kez yayınladığında site yeni deploy olmadan güncellenir; bot bir gün
 * atlarsa liste 48 saat sonra kendiliğinden kaybolur.
 *
 * Yetki: `Authorization: Bearer <EDITOR_TOKEN>` (sabit-zamanlı karşılaştırma).
 * Service role anahtarı yalnızca sunucuda okunur; yanıtlara/loglara girmez.
 *
 * Durum kodları: 200 eklenen satırlar · 400 geçersiz gövde · 401 yetkisiz ·
 * 405 yöntem · 502 Supabase hatası · 503 yapılandırma eksik.
 */

const STATUSES = ["resmi", "dedikodu", "imza"];
const LIMITS = { text: 220, league: 60, source_name: 80, source_url: 500 };
const MAX_ITEMS = 20;
const TTL_MS = 48 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_BODY = 65536;

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
      if (data.length > MAX_BODY) { data = ""; resolve(null); }
    });
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(null));
  });
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (error) { return null; }
}

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateItem(item, index) {
  const at = `items[${index}]`;
  if (!item || typeof item !== "object" || Array.isArray(item)) return { error: `${at} nesne olmalı.` };
  const out = {
    text: str(item.text),
    status: str(item.status).toLowerCase(),
    league: str(item.league) || null,
    source_name: str(item.source_name),
    source_url: str(item.source_url)
  };
  for (const field of ["text", "source_name", "source_url"]) {
    if (!out[field]) return { error: `${at}.${field} zorunlu.` };
  }
  for (const field of Object.keys(LIMITS)) {
    if (out[field] && out[field].length > LIMITS[field]) {
      return { error: `${at}.${field} en fazla ${LIMITS[field]} karakter olabilir.` };
    }
  }
  if (!STATUSES.includes(out.status)) return { error: `${at}.status şunlardan biri olmalı: ${STATUSES.join(", ")}.` };
  if (!/^https:\/\/[^\s]+$/i.test(out.source_url)) return { error: `${at}.source_url https:// ile başlamalı.` };
  try { new URL(out.source_url); } catch (error) { return { error: `${at}.source_url geçersiz.` }; }
  if (!isAllowedSourceUrl(out.source_url)) return { error: `${at}.source_url izinli kaynak listesinde değil.` };
  return { value: out };
}

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "JSON gövdesi gerekli." };
  if (!Array.isArray(body.items) || body.items.length === 0) return { error: "items boş olmayan bir dizi olmalı." };
  if (body.items.length > MAX_ITEMS) return { error: `En fazla ${MAX_ITEMS} öğe gönderilebilir.` };
  if (body.replace !== undefined && typeof body.replace !== "boolean") return { error: "replace true/false olmalı." };
  const items = [];
  for (let i = 0; i < body.items.length; i += 1) {
    const checked = validateItem(body.items[i], i);
    if (checked.error) return checked;
    items.push(checked.value);
  }
  return { value: { items, replace: body.replace !== false } };
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

async function handleTickerPublish(req, res) {
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

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  };
  const now = new Date();
  const nowIso = now.toISOString();
  const table = `${restUrl}/rest/v1/transfer_ticker`;

  try {
    if (checked.value.replace) {
      const expireUrl = `${table}?or=${encodeURIComponent(`(expires_at.is.null,expires_at.gt.${nowIso})`)}`;
      const expired = await fetch(expireUrl, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ expires_at: nowIso }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });
      if (!expired.ok) return fail(res, 502, "UPSTREAM_ERROR", `Supabase hatası (${expired.status}).`);
    }

    const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
    const rows = checked.value.items.map((item, index) => ({
      ...item,
      sort: index,
      published_at: nowIso,
      expires_at: expiresAt
    }));
    const response = await fetch(table, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    let payload = null;
    try { payload = await response.json(); } catch (error) { payload = null; }
    if (!response.ok) return fail(res, 502, "UPSTREAM_ERROR", `Supabase hatası (${response.status}).`);
    const data = Array.isArray(payload) ? payload : [];
    return sendJson(res, 200, { ok: true, count: data.length, expires_at: expiresAt, data });
  } catch (error) {
    return fail(res, 502, "UPSTREAM_ERROR", "Supabase'e ulaşılamadı.");
  }
}

module.exports = { handleTickerPublish, validate, STATUSES, MAX_ITEMS };
