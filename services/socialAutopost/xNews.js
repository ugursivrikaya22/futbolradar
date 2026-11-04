/**
 * X (TWITTER) HABER PAYLAŞIMI — `/api/cron/x-news` ve `scripts/social-x-news.mjs`.
 *
 * Mevcut X otomatik paylaşımını (services/xAutopost, PR #541) GENİŞLETİR:
 * aynı OAuth 1.0a imzası + `POST /2/tweets` (postTweet), aynı Supabase tablosu
 * `x_autopost_posts` (kind = "news", anahtar `news:<slug>`). Ayrı bayrak:
 * X_NEWS_ENABLED=1 değilse (ya da X anahtarları / Supabase yoksa) KURU KOŞU.
 *
 * SPAM KONTROLÜ:
 *  - Koşu başına en fazla 1 haber tweeti.
 *  - Son 24 saatte en fazla X_NEWS_MAX_PER_DAY (varsayılan 4, 1-5 arası).
 *  - İki haber tweeti arasında en az X_NEWS_MIN_GAP_MINUTES (varsayılan 150 dk).
 *  - Yalnızca 09:00-22:59 (İstanbul) arası.
 *  - Aynı haber (`news:<slug>`) asla ikinci kez paylaşılmaz (ilk INSERT kazanır).
 * Not: haber tweetleri `x_autopost_posts` tablosuna yazıldığı için mevcut
 * X_MAX_PER_DAY (maç sonucu vb.) günlük sayımına da dahildir.
 */
const { postTweet, config: xConfig } = require("../xAutopost");
const { createStore } = require("../xAutopost/store");
const { weightedLength, MAX_WEIGHT } = require("../xAutopost/compose");
const news = require("./news");
const { on, int, istanbulHour, loadJsonFromSite, supabaseConfigured } = require("./common");

const FILES = { news: news.NEWS_FILE };
const KIND = "news";

function config(env = process.env) {
  const x = xConfig(env);
  const enabled = on(env.X_NEWS_ENABLED);
  return {
    creds: x.creds, missing: x.missing, enabled,
    live: enabled && !x.killed && x.missing.length === 0, marker: x.marker,
    maxPerDay: int(env.X_NEWS_MAX_PER_DAY, 4, 1, 5),
    minGapMinutes: int(env.X_NEWS_MIN_GAP_MINUTES, 150, 30, 720),
    windowHours: int(env.X_NEWS_WINDOW_HOURS, news.DEFAULT_WINDOW_HOURS, 1, 72),
    activeFrom: 9, activeTo: 22
  };
}

/** Saf karar fonksiyonu (test edilir): şu an tweet atılabilir mi? */
function gate({ postedLast24h, postedInGap, hour, cfg }) {
  if (hour < cfg.activeFrom || hour > cfg.activeTo) return "quiet-hours";
  if (postedLast24h >= cfg.maxPerDay) return "day-cap";
  if (postedInGap > 0) return "min-gap";
  return null;
}

async function runXNews({ env = process.env, now = new Date(), data, loader = (o) => loadJsonFromSite(FILES, o), store, fetcher = fetch, log = console.log } = {}) {
  const cfg = config(env);
  const live = cfg.live && Boolean(store || supabaseConfigured());
  const input = data || await loader({ fetcher });
  const candidates = news.newsCandidates(input.news, { now, windowHours: cfg.windowHours })
    .map((c) => ({ ...c, text: news.composeNewsTweet(c) }));
  const summary = { mode: live ? "live" : "dry-run", reason: live ? null : (!cfg.enabled ? "X_NEWS_ENABLED kapalı" : cfg.missing.length ? `eksik: ${cfg.missing.join(",")}` : "Supabase yapılandırılmamış"), candidates: candidates.length, posted: [], skipped: [], dryRun: [] };

  if (!live) {
    for (const c of candidates.slice(-cfg.maxPerDay)) {
      summary.dryRun.push({ key: c.key, length: weightedLength(c.text), text: c.text });
      log(`[x-news] KURU KOŞU (${summary.reason}) ${c.key} (${weightedLength(c.text)}/280)\n${c.text}\n---`);
    }
    return summary;
  }

  const db = store || createStore();
  const day = new Date(now.getTime() - 24 * 3600e3).toISOString();
  const gapStart = new Date(now.getTime() - cfg.minGapMinutes * 60e3).toISOString();
  const blocked = gate({ postedLast24h: await db.countSince(day, KIND), postedInGap: await db.countSince(gapStart, KIND), hour: istanbulHour(now), cfg });
  if (blocked) { summary.skipped.push({ reason: blocked }); log(`[x-news] bekleniyor: ${blocked}`); return summary; }

  const seen = await db.existing(candidates.map((c) => c.key));
  // En yeni paylaşılmamış haber önce: gecikmiş eski haber yerine güncel olan.
  const queue = candidates.filter((c) => !seen.has(c.key)).reverse();
  for (const item of queue) {
    if (weightedLength(item.text) > MAX_WEIGHT) { summary.skipped.push({ key: item.key, reason: "too-long" }); continue; }
    if (!(await db.claim({ key: item.key, kind: KIND, text: item.text }))) { summary.skipped.push({ key: item.key, reason: "already-claimed" }); continue; }
    try {
      const id = await postTweet(require("../xAutopost/compose").applyLinkMode({ text: item.text }, "inline", { marker: cfg.marker }).text, cfg.creds, { fetcher });
      await db.finish({ key: item.key, status: "posted", tweetId: id });
      summary.posted.push({ key: item.key, id });
      log(`[x-news] paylaşıldı ${item.key} → ${id}`);
    } catch (error) {
      const transient = error.status === 429 || error.status === 401 || !error.status || error.status >= 500;
      if (transient) await db.release(item.key);
      else await db.finish({ key: item.key, status: "failed", error: error.message });
      summary.skipped.push({ key: item.key, reason: error.message });
      log(`[x-news] hata ${item.key}: ${error.message}`);
    }
    break; // koşu başına en fazla 1 tweet
  }
  return summary;
}

module.exports = { FILES, KIND, config, gate, runXNews };
