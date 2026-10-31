"use strict";
/**
 * MAÇ ÖZETİ → X PAYLAŞIM KUYRUĞU.
 *
 * TASARIM (#541'in `x_autopost_posts` defterini yeniden kullanır):
 *   - Kuyruğa alma: `summary:<af:id|slug>` anahtarlı satır `status='queued'`
 *     ile yazılır (0016 göçü bu durumu ve `payload` sütununu ekler). İlk
 *     INSERT kazanır → aynı maç iki kez kuyruğa girmez.
 *   - `queued` satırlar #541'in günlük tavan sayımına (`posted,pending`)
 *     girmez ve #541'in aday anahtarlarıyla (`result:`, `goal:` …) çakışmaz.
 *   - Gönderim (drain) YALNIZCA şu üç koşul birlikte sağlanınca mümkündür:
 *       1) X_AUTOPOST_ENABLED=1            (#541 ana bayrağı, varsayılan kapalı)
 *       2) dört X anahtarı tanımlı         (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET)
 *       3) X_MATCH_SUMMARY_SHARE_ENABLED=1 (bu özelliğin ayrı bayrağı, varsayılan kapalı)
 *     Biri eksikse drain X'e ve Supabase'e HİÇBİR istek atmaz; satırlar
 *     `queued` olarak bekler.
 *   - Aynı maçın #541 "maç sonu" tweeti zaten gönderildiyse özet tweeti
 *     varsayılan olarak `skipped` işaretlenir (çift tweet / maliyet yok);
 *     X_MATCH_SUMMARY_SKIP_IF_RESULT_POSTED=0 ile kapatılabilir.
 *   - Özet tweeti, `/ozet/<slug>` sayfası yayımlanmış sicilde (SITE_URL/
 *     data/match-summaries.json) görünmeden gönderilmez (ölü bağlantı yok).
 */
const { SITE, scoreLine, summaryUrl } = require("./index");

const TABLE = "x_autopost_posts";
const KIND = "match-summary";
const ENQUEUE_WINDOW_MS = 48 * 3600e3;

function truthy(v) { return /^(1|true|yes|on)$/i.test(String(v || "").trim()); }

function queueKey(s) { return `summary:${s.afId ? `af:${s.afId}` : s.slug}`; }

function compose() { return require("../xAutopost/compose"); }

/** Tweet metni (≤280 ağırlıklı karakter, X t.co kuralı compose.js ile aynı). */
function summaryTweet(s, { includeLink = true } = {}) {
  const c = compose();
  const head = `📝 MAÇ ÖZETİ${s.league ? ` | ${s.league}` : ""}\n${scoreLine(s)}`;
  const url = summaryUrl(s.slug);
  const build = (body) => [head, body, includeLink ? url : ""].filter(Boolean).join("\n\n");
  return c.fitText(build, s.comment || "");
}

function queueItem(s, opts) {
  return { key: queueKey(s), kind: KIND, text: summaryTweet(s, opts), payload: { slug: s.slug, afId: s.afId || null, url: summaryUrl(s.slug), kickoff: s.kickoff } };
}

/** Gönderim kapısı. `live` yalnızca üç koşul birlikte sağlanınca true. */
function shareGate(env = process.env) {
  const { config } = require("../xAutopost");
  const cfg = config(env);
  const flag = truthy(env.X_MATCH_SUMMARY_SHARE_ENABLED);
  const reasons = [];
  if (!cfg.enabled) reasons.push("X_AUTOPOST_ENABLED kapalı");
  if (cfg.missing.length) reasons.push(`eksik: ${cfg.missing.join(",")}`);
  if (!flag) reasons.push("X_MATCH_SUMMARY_SHARE_ENABLED kapalı");
  return { live: cfg.live && flag, reasons, cfg };
}

function defaultRequest() { return require("../supabase/client").request; }
function supabaseConfigured() { try { return require("../supabase/client").isConfigured(); } catch { return false; } }

function createQueueStore({ request = defaultRequest() } = {}) {
  return {
    async enqueue(item) {
      const rows = await request(`${TABLE}?on_conflict=post_key`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify([{ post_key: item.key, kind: item.kind, text: item.text, status: "queued", payload: item.payload }])
      });
      return Array.isArray(rows) && rows.length > 0;
    },
    async listQueued(limit) {
      const rows = await request(`${TABLE}?select=post_key,kind,text,payload,created_at&status=eq.queued&kind=eq.${KIND}&order=created_at.asc&limit=${limit}`, { method: "GET" });
      return Array.isArray(rows) ? rows : [];
    },
    /** queued → pending geçişi; yalnızca hâlâ `queued` ise (eşzamanlı koşu güvenli). */
    async claim(key) {
      const rows = await request(`${TABLE}?post_key=eq.${encodeURIComponent(key)}&status=eq.queued`, {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "pending" })
      });
      return Array.isArray(rows) && rows.length > 0;
    },
    async isPosted(key) {
      const rows = await request(`${TABLE}?select=post_key&post_key=eq.${encodeURIComponent(key)}&status=eq.posted`, { method: "GET" });
      return Array.isArray(rows) && rows.length > 0;
    },
    async finish({ key, status, tweetId = null, error = null }) {
      await request(`${TABLE}?post_key=eq.${encodeURIComponent(key)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status, tweet_id: tweetId, error: error ? String(error).slice(0, 300) : null, posted_at: status === "posted" ? new Date().toISOString() : null })
      });
    },
    /** Geçici hatada satırı kuyruğa geri koyar. */
    async requeue(key) {
      await request(`${TABLE}?post_key=eq.${encodeURIComponent(key)}&status=eq.pending`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "queued" }) });
    },
    async countSince(iso) {
      const rows = await request(`${TABLE}?select=post_key&status=in.(posted,pending)&created_at=gte.${encodeURIComponent(iso)}`, { method: "GET" });
      return Array.isArray(rows) ? rows.length : 0;
    }
  };
}

/**
 * Yeni/son özetleri kuyruğa alır. X anahtarı GEREKMEZ, hiçbir şey göndermez.
 * Yalnızca başlaması son 48 saat içinde olan maçlar (ilk koşuda arşivin
 * tamamı kuyruğa dolmasın). Supabase yoksa sessizce atlar.
 */
async function enqueueSummaries(summaries, { now = new Date(), store, env = process.env, log = console.log } = {}) {
  const out = { status: "skipped", enqueued: [], already: [], outOfWindow: 0 };
  if (!store && !supabaseConfigured()) { out.reason = "Supabase yapılandırılmamış"; return out; }
  const db = store || createQueueStore();
  const includeLink = !/^(0|false|no|off)$/i.test(String(env.X_INCLUDE_LINKS || "").trim());
  out.status = "ok";
  for (const s of summaries) {
    const age = now.getTime() - Date.parse(s.kickoff);
    if (!(age >= 0 && age <= ENQUEUE_WINDOW_MS)) { out.outOfWindow += 1; continue; }
    const item = queueItem(s, { includeLink });
    if (await db.enqueue(item)) { out.enqueued.push(item.key); log(`[match-summary] X kuyruğuna alındı (gönderilmedi): ${item.key}`); }
    else out.already.push(item.key);
  }
  return out;
}

async function loadPublishedSlugs({ siteUrl = process.env.SITE_URL || SITE, fetcher = fetch } = {}) {
  const res = await fetcher(`${String(siteUrl).replace(/\/+$/, "")}/data/match-summaries.json`, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`match-summaries-${res.status}`);
  const body = await res.json();
  return new Set(Object.keys((body && body.summaries) || {}));
}

/**
 * Kuyruğu boşaltır — ANCAK `shareGate(env).live` ise. Aksi hâlde hiçbir
 * ağ/veritabanı isteği yapmadan `{ mode: "queued-only" }` döner.
 */
async function drainSummaryQueue({ env = process.env, now = new Date(), store, fetcher = fetch, publishedSlugs, post, log = console.log } = {}) {
  const gate = shareGate(env);
  if (!gate.live) return { mode: "queued-only", reason: gate.reasons.join("; "), posted: [], skipped: [] };
  if (!store && !supabaseConfigured()) return { mode: "queued-only", reason: "Supabase yapılandırılmamış", posted: [], skipped: [] };
  const db = store || createQueueStore();
  const { istanbul, postTweet } = require("../xAutopost");
  const send = post || ((text) => postTweet(text, gate.cfg.creds, { fetcher }));
  const maxPerRun = Math.min(Number.isInteger(Number(env.X_MATCH_SUMMARY_MAX_PER_RUN)) ? Number(env.X_MATCH_SUMMARY_MAX_PER_RUN) : 2, 10);
  const skipIfResult = !/^(0|false|no|off)$/i.test(String(env.X_MATCH_SUMMARY_SKIP_IF_RESULT_POSTED || "").trim());
  const published = publishedSlugs || await loadPublishedSlugs({ fetcher });
  let today = await db.countSince(istanbul(now).dayStartIso);
  const summary = { mode: "live", posted: [], skipped: [] };
  for (const row of await db.listQueued(20)) {
    if (summary.posted.length >= maxPerRun) break;
    if (today >= gate.cfg.maxPerDay) { summary.skipped.push({ key: row.post_key, reason: "day-cap" }); break; }
    const slug = row.payload && row.payload.slug;
    if (!slug || !published.has(slug)) { summary.skipped.push({ key: row.post_key, reason: "page-not-published-yet" }); continue; }
    const af = row.payload && row.payload.afId;
    if (skipIfResult && af && await db.isPosted(`result:af:${af}`)) {
      await db.finish({ key: row.post_key, status: "skipped", error: "result-already-posted" });
      summary.skipped.push({ key: row.post_key, reason: "result-already-posted" });
      continue;
    }
    if (!(await db.claim(row.post_key))) { summary.skipped.push({ key: row.post_key, reason: "already-claimed" }); continue; }
    try {
      const tweetId = await send(row.text);
      await db.finish({ key: row.post_key, status: "posted", tweetId });
      summary.posted.push({ key: row.post_key, tweetId });
      today += 1;
      log(`[match-summary] X'e gönderildi ${row.post_key} → ${tweetId}`);
    } catch (error) {
      const transient = !error.status || error.status === 429 || error.status >= 500;
      if (transient) await db.requeue(row.post_key); else await db.finish({ key: row.post_key, status: "failed", error: error.message });
      summary.skipped.push({ key: row.post_key, reason: transient ? "transient-error" : "failed" });
    }
  }
  return summary;
}

module.exports = { TABLE, KIND, ENQUEUE_WINDOW_MS, queueKey, summaryTweet, queueItem, shareGate, createQueueStore, enqueueSummaries, drainSummaryQueue, loadPublishedSlugs };
