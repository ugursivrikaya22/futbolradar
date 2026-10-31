/**
 * Resend REST istemcisi — düz fetch, npm bağımlılığı yok.
 * Toplu uç: POST /emails/batch (istek başına en fazla 100 e-posta).
 */
const { resendKey } = require("./config");

const API = "https://api.resend.com";
const BATCH_MAX = 100;
const MIN_INTERVAL_MS = 600; // Resend takım hız sınırı (istek/sn) altında kalmak için
const TIMEOUT_MS = 15000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, body, { fetcher = fetch, idempotencyKey, env = process.env } = {}) {
  const key = resendKey(env);
  if (!key) throw new Error("resend-not-configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(`${API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {})
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const raw = await response.text();
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (error) { parsed = null; }
    if (!response.ok) {
      const err = new Error(`resend-http-${response.status}: ${String((parsed && (parsed.message || parsed.name)) || raw).slice(0, 200)}`);
      err.status = response.status;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function sendOne(email, options = {}) {
  return request("/emails", email, options);
}

/** 429 ya da 5xx'te bir kez bekleyip yeniden dener (aynı Idempotency-Key ile). */
async function sendBatch(emails, options = {}) {
  if (!Array.isArray(emails) || !emails.length) return { data: [] };
  if (emails.length > BATCH_MAX) throw new Error("resend-batch-too-large");
  try {
    return await request("/emails/batch", emails, options);
  } catch (error) {
    if (error.status === 429 || (error.status >= 500 && error.status < 600)) {
      await (options.sleep || sleep)(2000);
      return request("/emails/batch", emails, options);
    }
    throw error;
  }
}

module.exports = { API, BATCH_MAX, MIN_INTERVAL_MS, sendOne, sendBatch, sleep };
