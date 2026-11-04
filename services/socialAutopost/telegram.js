/**
 * TELEGRAM KANAL/GRUP BİLDİRİMİ — `/api/cron/telegram-notify` ve
 * `scripts/social-telegram.mjs`.
 *
 * Bot API: POST https://api.telegram.org/bot<TOKEN>/sendMessage
 * gövde { chat_id, text, parse_mode: "HTML", link_preview_options }.
 * Yanıt { ok: true, result: { message_id } } / { ok: false, error_code, description }.
 *
 * İÇERİK: yeni doğrulanmış haberler (data/news.json) + biten maçların sonucu
 * (X otomatik paylaşımının buildCandidates#results'ı; aynı kapsam, aynı
 * kural tabanlı analiz cümlesi, yeni API-Football isteği YOK).
 *
 * VARSAYILAN KURU KOŞU: TELEGRAM_ENABLED=1 + TELEGRAM_BOT_TOKEN +
 * TELEGRAM_CHAT_ID + Supabase yoksa hiçbir şey gönderilmez.
 * DEDUP: Supabase `telegram_posts` (0016) — ilk INSERT kazanır.
 * TAVAN: koşu başına TELEGRAM_MAX_PER_RUN (3), son 24 saatte TELEGRAM_MAX_PER_DAY (15).
 */
const { createStore } = require("../xAutopost/store");
const xAutopost = require("../xAutopost");
const news = require("./news");
const { on, int, loadJsonFromSite, supabaseConfigured } = require("./common");

const TABLE = "telegram_posts";
const API_BASE = "https://api.telegram.org";
const FILES = { news: news.NEWS_FILE, calendar: xAutopost.DATA_FILES.calendar, seoIndex: xAutopost.DATA_FILES.seoIndex };

function config(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  const enabled = on(env.TELEGRAM_ENABLED);
  const missing = Object.entries({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId }).filter(([, v]) => !v).map(([k]) => k);
  return {
    token, chatId, enabled, missing,
    live: enabled && missing.length === 0,
    maxPerRun: int(env.TELEGRAM_MAX_PER_RUN, 3, 1, 10),
    maxPerDay: int(env.TELEGRAM_MAX_PER_DAY, 15, 1, 50),
    windowHours: int(env.TELEGRAM_NEWS_WINDOW_HOURS, news.DEFAULT_WINDOW_HOURS, 1, 72),
    includeResults: !/^(0|false|no|off)$/i.test(String(env.TELEGRAM_INCLUDE_RESULTS || "").trim()),
    favorites: xAutopost.config(env).favorites
  };
}

function buildMessages(input, { now = new Date(), cfg }) {
  const items = news.newsCandidates(input.news, { now, windowHours: cfg.windowHours })
    .map((c) => ({ key: c.key, kind: "news", at: c.at, text: news.composeNewsTelegram(c) }));
  if (cfg.includeResults && input.calendar && input.seoIndex) {
    const { results } = xAutopost.buildCandidates({ calendar: input.calendar, seoIndex: input.seoIndex, columns: null, transfers: [], leaders: null }, { now, favorites: cfg.favorites });
    for (const r of results) items.push({ key: r.key, kind: "result", at: r.at, text: news.plainToTelegram(r.text) });
  }
  return items.sort((a, b) => a.at - b.at);
}

async function sendMessage(text, { token, chatId }, { fetcher = fetch } = {}) {
  const response = await fetcher(`${API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: false } }),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body || body.ok !== true) {
    // Token hiçbir zaman hata metnine konmaz.
    const error = new Error(`telegram-http-${response.status}: ${String(body && body.description || "").slice(0, 160)}`);
    error.status = response.status;
    throw error;
  }
  return body.result && body.result.message_id != null ? String(body.result.message_id) : null;
}

async function runTelegramNotify({ env = process.env, now = new Date(), data, loader = (o) => loadJsonFromSite(FILES, o), store, fetcher = fetch, log = console.log } = {}) {
  const cfg = config(env);
  const live = cfg.live && Boolean(store || supabaseConfigured());
  const input = data || await loader({ fetcher });
  const messages = buildMessages(input, { now, cfg });
  const summary = { mode: live ? "live" : "dry-run", reason: live ? null : (!cfg.enabled ? "TELEGRAM_ENABLED kapalı" : cfg.missing.length ? `eksik: ${cfg.missing.join(",")}` : "Supabase yapılandırılmamış"), candidates: messages.length, posted: [], skipped: [], dryRun: [] };

  if (!live) {
    for (const m of messages.slice(-cfg.maxPerRun)) {
      summary.dryRun.push({ key: m.key, kind: m.kind, text: m.text });
      log(`[telegram] KURU KOŞU (${summary.reason}) ${m.key}\n${m.text}\n---`);
    }
    return summary;
  }

  const db = store || createStore({ table: TABLE, idColumn: "message_id" });
  let last24h = await db.countSince(new Date(now.getTime() - 24 * 3600e3).toISOString());
  const seen = await db.existing(messages.map((m) => m.key));
  for (const m of messages.filter((x) => !seen.has(x.key))) {
    if (summary.posted.length >= cfg.maxPerRun) { summary.skipped.push({ key: m.key, reason: "run-cap" }); continue; }
    if (last24h >= cfg.maxPerDay) { summary.skipped.push({ key: m.key, reason: "day-cap" }); continue; }
    if (!(await db.claim({ key: m.key, kind: m.kind, text: m.text }))) { summary.skipped.push({ key: m.key, reason: "already-claimed" }); continue; }
    last24h += 1;
    try {
      const id = await sendMessage(m.text, cfg, { fetcher });
      await db.finish({ key: m.key, status: "posted", messageId: id });
      summary.posted.push({ key: m.key, id });
      log(`[telegram] gönderildi ${m.key} → ${id}`);
    } catch (error) {
      const transient = error.status === 429 || !error.status || error.status >= 500;
      if (transient) { await db.release(m.key); last24h -= 1; }
      else await db.finish({ key: m.key, status: "failed", error: error.message });
      summary.skipped.push({ key: m.key, reason: error.message });
      log(`[telegram] hata ${m.key}: ${error.message}`);
      if (transient || error.status === 401 || error.status === 403) break;
    }
  }
  return summary;
}

module.exports = { TABLE, API_BASE, FILES, config, buildMessages, sendMessage, runTelegramNotify };
