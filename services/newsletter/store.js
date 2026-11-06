/**
 * Bülten abone deposu — Supabase PostgREST'e düz fetch, yalnızca service-role
 * anahtarıyla (RLS açık, anon/authenticated için politika YOK → liste asla
 * herkese açık değildir). Şema: supabase/migrations/0017_newsletter.sql
 */
const crypto = require("crypto");
const { isConfigured, restUrl, serviceKey } = require("../supabase/env");

const SUBSCRIBERS = "newsletter_subscribers";
const SENDS = "newsletter_sends";
const TIMEOUT_MS = 6000;

function token() {
  return crypto.randomBytes(32).toString("base64url");
}
function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

async function rest(pathname, options = {}, fetcher = fetch) {
  const base = restUrl();
  const key = serviceKey();
  if (!base || !key) throw new Error("newsletter-store-not-configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(`${base}/rest/v1/${pathname}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`newsletter-store-http-${response.status}`);
    return raw ? JSON.parse(raw) : [];
  } finally {
    clearTimeout(timer);
  }
}

function createStore({ fetcher = fetch } = {}) {
  const call = (p, o) => rest(p, o, fetcher);
  return {
    isConfigured,
    async findByEmail(email) {
      const rows = await call(`${SUBSCRIBERS}?email=eq.${encodeURIComponent(email)}&select=id,status,confirm_sent_at&limit=1`);
      return rows[0] || null;
    },
    async insertPending({ email, name, consentText, consentVersion, ipHash, confirmHash }) {
      const now = new Date().toISOString();
      await call(`${SUBSCRIBERS}?on_conflict=email`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ email, name, status: "pending", consent_text: consentText, consent_version: consentVersion, consent_at: now, consent_ip_hash: ipHash, confirm_token_hash: confirmHash, confirm_sent_at: now, unsubscribe_token: token() })
      });
    },
    async refreshPending(id, { name, consentText, consentVersion, ipHash, confirmHash }) {
      const now = new Date().toISOString();
      await call(`${SUBSCRIBERS}?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ name, status: "pending", consent_text: consentText, consent_version: consentVersion, consent_at: now, consent_ip_hash: ipHash, confirm_token_hash: confirmHash, confirm_sent_at: now, unsubscribed_at: null, updated_at: now })
      });
    },
    /** Onay: belirteç karması eşleşir ve 48 saatten eskiyse geçersiz. */
    async confirm(rawToken) {
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const now = new Date().toISOString();
      const rows = await call(`${SUBSCRIBERS}?confirm_token_hash=eq.${hashToken(rawToken)}&status=eq.pending&confirm_sent_at=gte.${encodeURIComponent(since)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "confirmed", confirmed_at: now, confirm_token_hash: null, updated_at: now })
      });
      return rows.length > 0;
    },
    async unsubscribe(unsubToken) {
      const now = new Date().toISOString();
      const rows = await call(`${SUBSCRIBERS}?unsubscribe_token=eq.${encodeURIComponent(unsubToken)}&status=neq.unsubscribed`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "unsubscribed", unsubscribed_at: now, confirm_token_hash: null, updated_at: now })
      });
      return rows.length > 0;
    },
    async listConfirmed() {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const rows = await call(`${SUBSCRIBERS}?status=eq.confirmed&select=id,email,name,unsubscribe_token&order=id.asc&limit=1000&offset=${offset}`);
        out.push(...rows);
        if (rows.length < 1000) return out;
      }
    },
    async sentIds(issueKey) {
      const ids = new Set();
      for (let offset = 0; ; offset += 1000) {
        const rows = await call(`${SENDS}?issue_key=eq.${encodeURIComponent(issueKey)}&status=in.(sending,sent)&select=subscriber_id&limit=1000&offset=${offset}`);
        rows.forEach((r) => ids.add(String(r.subscriber_id)));
        if (rows.length < 1000) return ids;
      }
    },
    /** Gönderimden ÖNCE talep: (issue_key, subscriber_id) benzersiz; çakışan satır atlanır. */
    async claim(issueKey, ids) {
      if (!ids.length) return [];
      const rows = await call(`${SENDS}?on_conflict=issue_key,subscriber_id`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(ids.map((id) => ({ issue_key: issueKey, subscriber_id: id, status: "sending" })))
      });
      return rows.map((r) => String(r.subscriber_id));
    },
    async mark(issueKey, ids, statusValue, providerIds = {}) {
      if (!ids.length) return;
      const now = new Date().toISOString();
      if (statusValue === "failed") {
        // Başarısız talepler silinir: sonraki deneme bu aboneleri yeniden gönderir.
        await call(`${SENDS}?issue_key=eq.${encodeURIComponent(issueKey)}&subscriber_id=in.(${ids.map(encodeURIComponent).join(",")})&status=eq.sending`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        return;
      }
      await call(`${SENDS}?on_conflict=issue_key,subscriber_id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(ids.map((id) => ({ issue_key: issueKey, subscriber_id: id, status: statusValue, sent_at: now, provider_message_id: providerIds[id] || null })))
      });
    }
  };
}

module.exports = { createStore, token, hashToken };
