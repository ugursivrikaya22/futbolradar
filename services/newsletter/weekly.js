/**
 * HAFTALIK BÜLTEN GÖNDERİMİ — Vercel cron: /api/cron/newsletter (Pazartesi 06:00 UTC = 09:00 TSİ).
 *
 * - NEWSLETTER_ENABLED=1 + RESEND_API_KEY + NEWSLETTER_FROM yoksa: kuru çalışma, HİÇBİR e-posta gitmez.
 * - Sayı başına tekilleştirme: newsletter_sends (issue_key, subscriber_id) benzersiz. Her parti
 *   gönderimden ÖNCE "sending" olarak talep edilir, başarıda "sent" olur, hatada talep silinir.
 *   Yeniden deneme yalnızca hiç talep edilmemiş aboneleri gönderir → çift gönderim olmaz.
 * - Resend toplu ucu: parti başına ≤100 e-posta, partiler arası bekleme + Idempotency-Key.
 */
const config = require("./config");
const content = require("./content");
const render = require("./render");
const resend = require("./resend");
const { createStore } = require("./store");

function unsubscribeUrl(site, tokenValue) {
  return `${site}/api/newsletter?action=unsubscribe&token=${encodeURIComponent(tokenValue)}`;
}

function emailFor(issue, subscriber, from) {
  const unsub = unsubscribeUrl(issue.site, subscriber.unsubscribe_token);
  return {
    from,
    to: [subscriber.email],
    subject: render.subject(issue),
    html: render.renderHtml(issue, { name: subscriber.name || "", unsubscribeUrl: unsub }),
    text: render.renderText(issue, { name: subscriber.name || "", unsubscribeUrl: unsub }),
    headers: {
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  };
}

async function supabaseColumns(fetcher) {
  try {
    const { restUrl, serviceKey } = require("../supabase/env");
    const base = restUrl(); const key = serviceKey();
    if (!base || !key) return null;
    const r = await fetcher(`${base}/rest/v1/columns?select=slug,title,excerpt,url,published_at&order=published_at.desc&limit=10`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    return r.ok ? await r.json() : null;
  } catch (error) { return null; }
}

async function runWeekly({ env = process.env, now = Date.now(), fetcher = fetch, store = null, sources = null, sleep = resend.sleep, budgetMs = 240000 } = {}) {
  const t0 = Date.now();
  const site = config.siteUrl(env);
  const src = sources || await content.loadSourcesFromSite(site, { fetcher, supabaseColumns: await supabaseColumns(fetcher) });
  const issue = content.buildIssue(src, { now, site });
  const summary = { issue: issue.key, results: issue.results.length, standings: issue.standings.rows.length, columns: issue.columns.length };
  if (!config.sendingEnabled(env)) return { status: "dry-run", reason: "NEWSLETTER_ENABLED/RESEND_API_KEY/NEWSLETTER_FROM eksik", ...summary };
  if (issue.empty) return { status: "skipped", reason: "empty-issue", ...summary };
  const db = store || createStore({ fetcher });
  if (!db.isConfigured()) return { status: "skipped", reason: "store-not-configured", ...summary };

  const from = config.fromAddress(env);
  const subscribers = await db.listConfirmed();
  const done = await db.sentIds(issue.key);
  const pending = subscribers.filter((s) => !done.has(String(s.id)));
  let sent = 0; let failed = 0; let batches = 0;
  for (let i = 0; i < pending.length; i += resend.BATCH_MAX) {
    if (Date.now() - t0 > budgetMs) return { status: "partial", reason: "budget", sent, failed, remaining: pending.length - i, ...summary };
    const chunk = pending.slice(i, i + resend.BATCH_MAX);
    const claimed = new Set(await db.claim(issue.key, chunk.map((s) => String(s.id))));
    const batch = chunk.filter((s) => claimed.has(String(s.id)));
    if (!batch.length) continue;
    const ids = batch.map((s) => String(s.id));
    try {
      if (batches > 0) await sleep(resend.MIN_INTERVAL_MS);
      const response = await resend.sendBatch(batch.map((s) => emailFor(issue, s, from)), { fetcher, env, idempotencyKey: `${issue.key}:${ids[0]}:${ids[ids.length - 1]}:${ids.length}`, sleep });
      batches += 1;
      const providerIds = {};
      ((response && response.data) || []).forEach((d, idx) => { if (ids[idx] && d && d.id) providerIds[ids[idx]] = d.id; });
      await db.mark(issue.key, ids, "sent", providerIds);
      sent += ids.length;
    } catch (error) {
      batches += 1;
      failed += ids.length;
      await db.mark(issue.key, ids, "failed").catch(() => {});
      console.warn(`[newsletter] batch failed: ${String(error && error.message || error).slice(0, 160)}`);
    }
  }
  return { status: failed ? "partial" : "complete", sent, failed, subscribers: subscribers.length, alreadySent: done.size, ...summary };
}

module.exports = { runWeekly, emailFor, unsubscribeUrl };
