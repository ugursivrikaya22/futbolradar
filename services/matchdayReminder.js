/**
 * PWA PUSH — "FAVORİ TAKIMININ MAÇI BUGÜN" HATIRLATMASI.
 *
 * NEDEN AYRI İŞ. Mevcut gol/maç başı bildirimleri (`services/pushNotifier.js`)
 * yalnızca `LiveScoreHub` bir SSE bağlantısıyla yoklarken tetiklenir; maç
 * gününün sabahında kimse bağlı değilken hiçbir şey çalışmaz ve "maç bugün"
 * hatırlatması hiç yoktu. Bu iş Vercel Cron'dan (`/api/cron/matchday-reminder`,
 * saatlik, 09:05–22:05 İstanbul) çalışır.
 *
 * VERİ: yeni API-Football isteği YOK. Yayımlanmış `data/fixture-calendar.json`,
 * `data/teams.json` ve `data/match-seo-index.json` SITE_URL'den okunur (cron
 * işlevinin paketinde `data/` yok). Takım adı/saat yalnızca takvimden.
 *
 * KURAL (Europe/Istanbul):
 *  - Maç bugün (İstanbul takvim günü), başlamamış, başlamaya ≥15 dk var.
 *  - Sessiz saatler: PUSH_MATCHDAY_START_HOUR (9) öncesi ve 22:00 sonrası gönderilmez.
 *  - Tekrar yok: `push_reminder_log` tablosunda `matchday:<gün>:<maç>:<takım>`
 *    anahtarı ilk INSERT ile alınır (0015 migrasyonu). Tablo yoksa ya da
 *    alınamazsa GÖNDERİLMEZ (tekrarsızlık garanti edilemiyorsa sessiz kal).
 *  - VAPID ya da Supabase yoksa hiçbir şey yapmaz. PUSH_MATCHDAY_REMINDER_ENABLED=0 kapatır.
 */
const webPush = require("./webPush");
const pushSubscriptionStore = require("./pushSubscriptionStore");
const { teamIdForName } = require("./teamIdentity");

const LOG_TABLE = "push_reminder_log";
const QUIET_FROM_HOUR = 22;
const MIN_LEAD_MS = 15 * 60e3;
const FINISHED_OR_LIVE = /^(FINISHED|FT|AET|PEN|LIVE|IN_PLAY|1H|2H|ET|HT|BT|P|PAUSED|SUSP|INT|ABD|CANC|PST|AWD|WO)$/i;
const SITE = "https://www.futbolradar.com";
const DATA_FILES = { calendar: "data/fixture-calendar.json", teams: "data/teams.json", seoIndex: "data/match-seo-index.json" };

function config(env = process.env) {
  const hour = Number(env.PUSH_MATCHDAY_START_HOUR);
  return {
    enabled: !/^(0|false|no|off)$/i.test(String(env.PUSH_MATCHDAY_REMINDER_ENABLED || "").trim()),
    startHour: Number.isInteger(hour) && hour >= 6 && hour <= 20 ? hour : 9,
    vapid: {
      publicKey: String(env.VAPID_PUBLIC_KEY || "").trim(),
      privateKey: String(env.VAPID_PRIVATE_KEY || "").trim(),
      subject: String(env.VAPID_SUBJECT || "").trim()
    }
  };
}

function istanbulParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), time: `${p.hour}:${p.minute}` };
}

function matchList(calendar) {
  return Array.isArray(calendar) ? calendar : (calendar && Array.isArray(calendar.matches) ? calendar.matches : []);
}

function matchKey(m) {
  const af = m.providerIds && m.providerIds.apiFootball;
  return af ? `af:${af}` : String(m.id || "");
}

function slugOf(m, seoIndex) {
  const ids = m.providerIds || {};
  const index = seoIndex || {};
  return (ids.apiFootball && index[`af:${ids.apiFootball}`]) || (ids.theSportsDb && index[`tsdb:${ids.theSportsDb}`]) || null;
}

function buildPayload(m, { slug } = {}) {
  const t = istanbulParts(new Date(m.kickoff)).time;
  return {
    title: "📅 Favori takımının maçı bugün",
    body: `${m.homeTeam} - ${m.awayTeam} · bugün saat ${t}${m.league ? ` · ${m.league}` : ""}`,
    tag: `matchday-${matchKey(m)}`,
    url: slug ? `/mac/${slug}` : "/canli-skor.html"
  };
}

/**
 * Saf: bugünün hatırlatma adayları. Her aday: { key, teamId, match, payload, ttlSeconds }.
 * Sessiz saatlerde boş döner.
 */
function buildReminders({ calendar, teams, seoIndex }, { now = new Date(), startHour = 9 } = {}) {
  const here = istanbulParts(now);
  if (here.hour < startHour || here.hour >= QUIET_FROM_HOUR) return [];
  const out = [];
  for (const m of matchList(calendar)) {
    if (!m || !m.homeTeam || !m.awayTeam) continue;
    const kick = Date.parse(m.kickoff);
    if (!Number.isFinite(kick) || kick - now.getTime() < MIN_LEAD_MS) continue;
    if (istanbulParts(new Date(kick)).date !== here.date) continue;
    if (FINISHED_OR_LIVE.test(String(m.providerStatus || "")) || FINISHED_OR_LIVE.test(String(m.status || "")) || m.live) continue;
    const id = matchKey(m);
    if (!id) continue;
    const payload = buildPayload(m, { slug: slugOf(m, seoIndex) });
    const ttlSeconds = Math.max(60, Math.floor((kick - now.getTime()) / 1000));
    const teamIds = [...new Set([teamIdForName(m.homeTeam, teams), teamIdForName(m.awayTeam, teams)].filter(Boolean))];
    for (const teamId of teamIds) out.push({ key: `matchday:${here.date}:${id}:${teamId}`, teamId, match: id, payload, ttlSeconds });
  }
  return out;
}

async function loadFromSite({ siteUrl = process.env.SITE_URL || SITE, fetcher = fetch } = {}) {
  const base = String(siteUrl).replace(/\/+$/, "");
  const out = {};
  await Promise.all(Object.entries(DATA_FILES).map(async ([name, rel]) => {
    const response = await fetcher(`${base}/${rel}`, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`matchday-reminder-data-${response.status}: ${rel}`);
    out[name] = await response.json();
  }));
  return out;
}

function createLog({ request } = {}) {
  const req = request || require("./supabase/client").request;
  return {
    /** İlk INSERT kazanır; true = bu koşu gönderebilir. */
    async claim(key, info) {
      const rows = await req(`${LOG_TABLE}?on_conflict=reminder_key`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify([{ reminder_key: key, kind: "matchday", info }])
      });
      return Array.isArray(rows) && rows.length > 0;
    },
    async finish(key, sent) {
      await req(`${LOG_TABLE}?reminder_key=eq.${encodeURIComponent(key)}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sent_count: sent })
      });
    }
  };
}

/**
 * Bir koşu. Dönen: { status, reason?, reminders, sent, skipped[] }.
 * `data`, `subscriptions`, `log`, `send` testte enjekte edilir.
 */
async function runMatchdayReminder({ env = process.env, now = new Date(), data, loader = loadFromSite, subscriptions = pushSubscriptionStore, log, send = webPush.sendNotification, logger = console.log } = {}) {
  const cfg = config(env);
  if (!cfg.enabled) return { status: "skipped", reason: "PUSH_MATCHDAY_REMINDER_ENABLED=0" };
  if (!cfg.vapid.publicKey || !cfg.vapid.privateKey || !cfg.vapid.subject) return { status: "skipped", reason: "vapid-not-configured" };
  if (!subscriptions.isConfigured()) return { status: "skipped", reason: "supabase-not-configured" };
  const here = istanbulParts(now);
  if (here.hour < cfg.startHour || here.hour >= QUIET_FROM_HOUR) return { status: "skipped", reason: "quiet-hours" };

  const input = data || await loader({});
  const reminders = buildReminders(input, { now, startHour: cfg.startHour });
  const db = log || createLog();
  const summary = { status: "complete", reminders: reminders.length, sent: 0, skipped: [] };
  for (const r of reminders) {
    let subs;
    try { subs = await subscriptions.listByTeam(r.teamId); } catch (error) { summary.skipped.push({ key: r.key, reason: "list-failed" }); continue; }
    if (!subs.length) { summary.skipped.push({ key: r.key, reason: "no-subscribers" }); continue; }
    let claimed = false;
    try { claimed = await db.claim(r.key, `${r.payload.body}`.slice(0, 200)); } catch (error) {
      summary.status = "partial"; summary.skipped.push({ key: r.key, reason: `log-unavailable: ${String(error.message).slice(0, 80)}` }); continue;
    }
    if (!claimed) { summary.skipped.push({ key: r.key, reason: "already-sent" }); continue; }
    let sent = 0;
    await Promise.allSettled(subs.map(async (s) => {
      try {
        const res = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, r.payload, { vapidPublicKey: cfg.vapid.publicKey, vapidPrivateKey: cfg.vapid.privateKey, vapidSubject: cfg.vapid.subject, ttlSeconds: r.ttlSeconds });
        if (res && res.expired) await subscriptions.removeSubscription(s.endpoint);
        else if (res && res.ok) { sent += 1; await subscriptions.markSent(s.endpoint); }
      } catch (error) { /* tek abone hatası diğerlerini etkilemez */ }
    }));
    summary.sent += sent;
    try { await db.finish(r.key, sent); } catch (error) { /* teşhis sütunu; gönderim tamam */ }
    logger(`[matchday-reminder] ${r.key} → ${sent}/${subs.length}`);
  }
  return summary;
}

module.exports = { LOG_TABLE, config, buildPayload, buildReminders, runMatchdayReminder, loadFromSite, createLog, istanbulParts };
