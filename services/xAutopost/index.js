/**
 * X (TWITTER) OTOMATİK PAYLAŞIM — Vercel Cron işi `/api/cron/x-autopost`.
 *
 * VERİ: Yeni API-Football isteği YOK. Saatlik iş motorunun zaten ürettiği
 * ve sitede yayımlanan dosyalar okunur (data/fixture-calendar.json,
 * data/match-seo-index.json, data/columns.json, data/transfers.json,
 * data/league-leaders.json). Cron işlevinin paketinde `data/` olmadığı için
 * dosyalar SITE_URL'den indirilir (cronJobEngine#seedDataFromSite ile aynı yol).
 *
 * VARSAYILAN: KURU KOŞU. X_AUTOPOST_ENABLED=1 değilse ya da dört X anahtarı
 * veya Supabase yapılandırması eksikse tweetler yalnızca loglanır; X'e de
 * Supabase'e de hiçbir şey yazılmaz.
 *
 * SIRA: favori takım golleri → maç sonuçları → maç öncesi anket/tahmin →
 * köşe yazıları → (maçsız gün) dolgu.
 * MAÇ ÖNCESİ (X_PREMATCH_POLLS_ENABLED=1, varsayılan KAPALI): favori takım /
 * Türkiye maçlarına başlamadan X_PREMATCH_HOURS (4) saat önce yerel X anketi
 * ("Kim kazanır?") ve/veya "Senin tahminin ne?" gönderisi; maç başına bir kez.
 * Tavanlar: koşu başına X_MAX_PER_RUN (4), günlük X_MAX_PER_DAY (8).
 * MALİYET: X API'de ücretsiz katman yok; bağlantılı gönderi $0.20, bağlantısız
 * $0.015. X_INCLUDE_LINKS=0 bağlantıyı çıkarır (bkz. docs/x-autopost.md).
 */
const compose = require("./compose");
const { authorizationHeader } = require("./oauth1");
const { createStore } = require("./store");
const { createThrottle, rateLimitWaitMs, WINDOW_15M, WINDOW_24H } = require("./throttle");
const { hashKey } = require("./dedupe");
const oauth2 = require("./oauth2");
const { normalizeName } = require("../teamIdentity");

const TWEET_ENDPOINT = "https://api.x.com/2/tweets";
const DEFAULT_FAVORITES = ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"];
const RESULT_WINDOW_MS = 6 * 3600e3;      // maç sonu: başlama + 6 sa içinde
const GOAL_WINDOW_MS = 3 * 3600e3;        // gol: canlı ya da başlama + 3 sa içinde
const COLUMN_WINDOW_MS = 48 * 3600e3;     // köşe yazısı: son 48 sa
const TRANSFER_WINDOW_DAYS = 7;
const PREMATCH_MIN_LEAD_MS = 10 * 60e3;  // başlamaya 10 dk'dan az kaldıysa anket açılmaz

/** Maçsız günde dolgu saatleri (İstanbul): 12:xx ve 19:xx. */
const FILLER_SLOTS = [{ id: "noon", hour: 12, prefer: ["transfers", "topAssists", "topScorers", "teamCompare"] }, { id: "evening", hour: 19, prefer: ["topScorers", "teamCompare", "transfers", "topAssists"] }];

const FINISHED = /^(FINISHED|FT|AET|PEN)$/i;
const LIVE = /^(LIVE|IN_PLAY|1H|2H|ET|HT|BT|P|PAUSED)$/i;

function config(env = process.env) {
  const creds = {
    consumerKey: String(env.X_API_KEY || "").trim(),
    consumerSecret: String(env.X_API_SECRET || "").trim(),
    token: String(env.X_ACCESS_TOKEN || "").trim(),
    tokenSecret: String(env.X_ACCESS_TOKEN_SECRET || "").trim()
  };
  const enabled = /^(1|true|yes|on)$/i.test(String(env.X_AUTOPOST_ENABLED || "").trim());
  // ACİL DURDURMA: X_AUTOPOST_KILL=1 her şeyi (x-autopost + x-live) kuru koşuya çeker.
  const killed = /^(1|true|yes|on)$/i.test(String(env.X_AUTOPOST_KILL || "").trim());
  // Kimlik: OAuth 2.0 (X_OAUTH2_CLIENT_ID + X_OAUTH2_REFRESH_TOKEN) varsa o;
  // yoksa mevcut OAuth 1.0a dört anahtarı.
  const authMode = oauth2.oauth2Configured(env) ? "oauth2" : "oauth1";
  if (authMode === "oauth2") creds.oauth2 = true;
  const missing = authMode === "oauth2" ? [] : Object.entries({ X_API_KEY: creds.consumerKey, X_API_SECRET: creds.consumerSecret, X_ACCESS_TOKEN: creds.token, X_ACCESS_TOKEN_SECRET: creds.tokenSecret }).filter(([, v]) => !v).map(([k]) => k);
  const linkRaw = String(env.X_LINK_MODE || "").trim().toLowerCase();
  const num = (v, d, max) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : d; };
  const favorites = String(env.X_FAVORITE_TEAMS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    creds, enabled, missing, killed, authMode,
    live: enabled && !killed && missing.length === 0,
    // Bağlantı: reply (varsayılan; kullanıcı isteği) | inline | none. X_INCLUDE_LINKS=0 → none.
    linkMode: /^(0|false|no|off)$/i.test(String(env.X_INCLUDE_LINKS || "").trim()) ? "none" : (["reply", "inline", "none"].includes(linkRaw) ? linkRaw : "reply"),
    marker: /^(0|false|no|off)$/i.test(String(env.X_AUTOMATED_MARKER || "").trim()) ? "" : compose.AUTOMATED_MARKER,
    // Gol kapsamı: superlig (varsayılan: tüm Süper Lig maçları + favorilerin diğer maçları) | favorites
    goalScope: /^favorites$/i.test(String(env.X_GOAL_SCOPE || "").trim()) ? "favorites" : "superlig",
    // Gol tweetinde bağlantı (bağlantılı gönderi $0.20) — varsayılan KAPALI.
    goalLinks: /^(1|true|yes|on)$/i.test(String(env.X_GOAL_LINKS || "").trim()),
    rateSafety: Math.min(1, Math.max(0.1, Number(env.X_RATE_SAFETY) || 0.8)),
    maxPerRun: num(env.X_MAX_PER_RUN, 6, 10),
    // Günlük tavan HER isteği sayar (ana gönderi + bağlantı yanıtı). Resmî sınırın çok altında; maliyet koruması.
    maxPerDay: num(env.X_MAX_PER_DAY, 30, 200),
    // X pay-per-use: bağlantılı gönderi $0.20, bağlantısız $0.015 (docs.x.com/x-api/getting-started/pricing).
    includeLinks: !/^(0|false|no|off)$/i.test(String(env.X_INCLUDE_LINKS || "").trim()),
    prematch: {
      enabled: /^(1|true|yes|on)$/i.test(String(env.X_PREMATCH_POLLS_ENABLED || "").trim()),
      mode: /^(poll|ask|both)$/i.test(String(env.X_PREMATCH_MODE || "").trim()) ? String(env.X_PREMATCH_MODE).trim().toLowerCase() : "poll",
      hours: Math.max(1, num(env.X_PREMATCH_HOURS, 4, 24)),
      maxPerDay: num(env.X_PREMATCH_MAX_PER_DAY, 3, 20)
    },
    favorites: (favorites.length ? favorites : DEFAULT_FAVORITES).map(normalizeName)
  };
}

function istanbul(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, hour: Number(p.hour), dayStartIso: new Date(`${date}T00:00:00+03:00`).toISOString() };
}

function matchList(calendar) {
  return Array.isArray(calendar) ? calendar : (calendar && Array.isArray(calendar.matches) ? calendar.matches : []);
}

function status(m) { return String(m.providerStatus || m.status || ""); }

/** Aday tweetler (öncelik sırasıyla). Saf: yalnızca girdilere ve `now`a bakar. */
function buildCandidates({ calendar, seoIndex, columns, transfers, leaders, standings }, { now = new Date(), favorites = DEFAULT_FAVORITES.map(normalizeName), prematch = null, goalScope = "favorites" } = {}) {
  const t = now.getTime();
  // matchSeoPages#slugForMatch ile aynı dizin anahtarları (af:/tsdb:). O modül
  // data/*.json'u require ettiği için cron işlevinde (paket içinde data/ yok)
  // yüklenemez; burada yalnızca yayımlanmış dizin okunur.
  const index = seoIndex || {};
  const slugOf = (m) => {
    const ids = m.providerIds || {};
    const af = ids.apiFootball || (/api-football/i.test(String(m.providerName || m.source || "")) ? m.providerId : null);
    return (af && index[`af:${af}`]) || (ids.theSportsDb && index[`tsdb:${ids.theSportsDb}`]) || null;
  };
  const matches = matchList(calendar);
  // KAPSAM: Süper Lig maçları + Süper Lig takımlarının (Avrupa kupaları dahil)
  // ve Türkiye millî takımının maçları. Takım listesi takvimin kendisinden
  // türetilir (sabit liste yok); favori takımlar her zaman kapsamdadır.
  const superLig = new Set(favorites);
  for (const m of matches) if (/^Süper Lig$/i.test(String(m.league || "").trim())) { superLig.add(normalizeName(m.homeTeam)); superLig.add(normalizeName(m.awayTeam)); }
  const inScope = (m) => superLig.has(normalizeName(m.homeTeam)) || superLig.has(normalizeName(m.awayTeam)) || /^türkiye$/i.test(String(m.homeTeam).trim()) || /^türkiye$/i.test(String(m.awayTeam).trim());
  const fav = new Set(favorites);
  const goals = []; const results = []; const prematchList = [];
  let todayHasMatch = false;
  const today = istanbul(now).date;
  for (const m of matches) {
    const kick = Date.parse(m.kickoff);
    if (!Number.isFinite(kick)) continue;
    const slug = slugOf(m);
    if (!inScope(m)) continue;
    if (!slug) continue; // kalıcı /mac/ sayfası olmayan maç paylaşılmaz (yalnızca sitenin izlediği yarışmalar)
    if (istanbul(new Date(kick)).date === today) todayHasMatch = true;
    const finished = FINISHED.test(status(m)) || FINISHED.test(String(m.status || ""));
    if (finished && t - kick >= 0 && t - kick <= RESULT_WINDOW_MS) {
      const c = compose.composeResult(m, slug);
      if (c) results.push({ ...c, at: kick });
    }
    const isFav = fav.has(normalizeName(m.homeTeam)) || fav.has(normalizeName(m.awayTeam));
    // MAÇ ÖNCESİ: yalnızca favori takım ya da Türkiye maçı, henüz başlamamış,
    // başlamaya [10 dk, X_PREMATCH_HOURS] kalmış. Takım adı/saat yalnızca takvimden.
    const national = /^türkiye$/i.test(String(m.homeTeam).trim()) || /^türkiye$/i.test(String(m.awayTeam).trim());
    if (prematch && prematch.enabled && (isFav || national) && !finished && !LIVE.test(status(m)) && !m.live
      && kick - t >= PREMATCH_MIN_LEAD_MS && kick - t <= prematch.hours * 3600e3) {
      const items = [];
      if (prematch.mode !== "ask") items.push(compose.composePrematchPoll(m, slug, { now }));
      if (prematch.mode !== "poll") items.push(compose.composePrematchAsk(m, slug, { now }));
      for (const c of items) if (c) prematchList.push({ ...c, at: kick });
    }
    const goalEligible = isFav || (goalScope === "superlig" && /^Süper Lig$/i.test(String(m.league || "").trim()));
    if (goalEligible && !finished && (LIVE.test(status(m)) || m.live) && t - kick <= GOAL_WINDOW_MS) {
      const evs = compose.goalEvents(m);
      evs.forEach((e, i) => {
        const c = compose.composeGoal(m, e, slug, { isLatest: i === evs.length - 1 });
        if (c) goals.push({ ...c, at: kick + i });
      });
    }
  }
  const cols = (columns && Array.isArray(columns.columns) ? columns.columns : Array.isArray(columns) ? columns : [])
    .filter((c) => c && c.status === "published" && Number.isFinite(Date.parse(c.date)) && t - Date.parse(c.date) >= 0 && t - Date.parse(c.date) <= COLUMN_WINDOW_MS)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map(compose.composeColumn).filter(Boolean);

  const fillers = [];
  if (!todayHasMatch) {
    const { hour } = istanbul(now);
    const slot = FILLER_SLOTS.find((s) => s.hour === hour);
    if (slot) {
      const recent = (Array.isArray(transfers) ? transfers : [])
        .filter((x) => x && x.status === "confirmed" && x.date && (t - Date.parse(`${x.date}T12:00:00+03:00`)) <= TRANSFER_WINDOW_DAYS * 864e5 && Date.parse(`${x.date}T00:00:00+03:00`) <= t)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const options = {
        transfers: () => compose.composeTransferDigest(recent, today),
        topScorers: () => compose.composeLeaderStat(leaders, "topScorers"),
        topAssists: () => compose.composeLeaderStat(leaders, "topAssists"),
        teamCompare: () => compose.composeTeamComparison(standings, Math.floor(Date.parse(`${today}T00:00:00Z`) / 864e5))
      };
      for (const id of slot.prefer) {
        const c = options[id]();
        // slotKey: aynı gün aynı saatte ikinci dolgu yok; içerik anahtarı: aynı tablo iki kez yok.
        if (c) fillers.push({ ...c, slotKey: `slot:${today}:${slot.id}` });
      }
    }
  }
  results.sort((a, b) => a.at - b.at);
  prematchList.sort((a, b) => a.at - b.at);
  return { goals, results, prematch: prematchList, columns: cols, fillers, todayHasMatch };
}

let tokenProvider = null;
/** OAuth 2.0 erişim belirteci sağlayıcısı (koşular arasında süreç içinde önbellek). */
function oauth2Provider({ env = process.env, fetcher = fetch, log } = {}) {
  if (!tokenProvider) {
    const tokenStore = /^supabase$/i.test(String(env.X_OAUTH2_TOKEN_STORE || "").trim()) ? oauth2.createSupabaseTokenStore() : null;
    tokenProvider = oauth2.createTokenProvider({ env, fetcher, tokenStore, log });
  }
  return tokenProvider;
}

async function authHeader(creds, { fetcher, env, tokens }) {
  if (creds && creds.oauth2) return `Bearer ${await (tokens || oauth2Provider({ env, fetcher })).getAccessToken()}`;
  return authorizationHeader({ method: "POST", url: TWEET_ENDPOINT, ...creds });
}

/**
 * POST /2/tweets. `replyTo`: bağlantı yanıtı için ana gönderinin kimliği.
 * Hata nesnesi `status` ve 429'da `waitMs` (Retry-After / x-rate-limit-reset) taşır.
 */
async function postTweet(text, creds, { fetcher = fetch, poll = null, replyTo = null, env = process.env, tokens = null, now = Date.now } = {}) {
  const payload = { text };
  // Anket: X API v2 `poll` alanı (2-4 seçenek, ≤25 karakter, 5-10080 dk; medya ile birlikte olamaz).
  if (poll) payload.poll = { options: poll.options, duration_minutes: poll.duration_minutes };
  if (replyTo) payload.reply = { in_reply_to_tweet_id: String(replyTo) };
  const send = async () => fetcher(TWEET_ENDPOINT, {
    method: "POST",
    headers: { Authorization: await authHeader(creds, { fetcher, env, tokens }), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });
  let response = await send();
  // OAuth 2.0: süresi dolmuş belirteç → bir kez yenile ve tekrar dene.
  if (response.status === 401 && creds && creds.oauth2) { (tokens || oauth2Provider({ env, fetcher })).invalidate(); response = await send(); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`x-http-${response.status}: ${String(body && (body.detail || body.title) || "").slice(0, 160)}`);
    error.status = response.status;
    if (response.status === 429) error.waitMs = rateLimitWaitMs(response.headers, { now: now() });
    throw error;
  }
  return body && body.data && body.data.id;
}

const DATA_FILES = {
  calendar: "data/fixture-calendar.json",
  seoIndex: "data/match-seo-index.json",
  columns: "data/columns.json",
  transfers: "data/transfers.json",
  leaders: "data/league-leaders.json",
  standings: "data/league-standings.json"
};

/** Yayımlanmış veri dosyalarını siteden indirir (cron işlevinde `data/` yok). */
async function loadFromSite({ siteUrl = process.env.SITE_URL || compose.SITE, fetcher = fetch } = {}) {
  const base = String(siteUrl).replace(/\/+$/, "");
  const out = {};
  await Promise.all(Object.entries(DATA_FILES).map(async ([name, rel]) => {
    const response = await fetcher(`${base}/${rel}`, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`x-autopost-data-${response.status}: ${rel}`);
    out[name] = await response.json();
  }));
  return out;
}

/** Yerel depo kopyasından okur (kuru koşu betiği ve testler). */
function loadFromDisk(root = process.cwd()) {
  const fs = require("fs"); const path = require("path");
  const out = {};
  for (const [name, rel] of Object.entries(DATA_FILES)) {
    try { out[name] = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { out[name] = null; }
  }
  return out;
}

function supabaseConfigured() {
  try { return require("../supabase/client").isConfigured(); } catch { return false; }
}

/** Aday tweete bağlantı modu + şeffaflık işaretini uygular. */
function finalize(item, cfg) {
  const mode = item.kind === "goal" && !cfg.goalLinks ? "none" : cfg.linkMode;
  // Anket gönderisi yanıt zinciriyle değil, tek gönderide kalır (bağlantı yanıtı yine olabilir).
  return compose.applyLinkMode(item, mode, { marker: cfg.marker });
}

/**
 * Bir koşu. Dönen: { mode, posted[], skipped[], dryRun[] }.
 * `store`/`fetcher`/`data`/`tokens` testte enjekte edilir.
 *
 * KUYRUK: öncelik sırası (goller → maç sonu → maç öncesi → köşe → dolgu).
 * KISICI: her istek (ana gönderi + bağlantı yanıtı) throttle.js'den geçer;
 * pencere sayımları depodan gelir (son 15 dk / son 24 sa). 429'da
 * Retry-After / x-rate-limit-reset okunur, anahtar bırakılır, koşu durur;
 * sonraki 15 dk'lık cron koşusu kuyruğu kaldığı yerden sürdürür.
 */
async function runXAutopost({ env = process.env, now = new Date(), data, loader = loadFromSite, store, fetcher = fetch, log = console.log, tokens = null, clock = () => now.getTime() } = {}) {
  const cfg = config(env);
  const live = cfg.live && (store || supabaseConfigured());
  const input = data || await loader({ fetcher });
  const c = buildCandidates(input, { now, favorites: cfg.favorites, prematch: cfg.prematch, goalScope: cfg.goalScope });
  for (const k of ["goals", "results", "prematch", "columns", "fillers"]) c[k] = c[k].map((item) => finalize(item, cfg));
  const ordered = [...c.goals, ...c.results, ...c.prematch, ...c.columns];
  const reason = live ? null : (cfg.killed ? "X_AUTOPOST_KILL açık (acil durdurma)" : !cfg.enabled ? "X_AUTOPOST_ENABLED kapalı" : cfg.missing.length ? `eksik: ${cfg.missing.join(",")}` : "Supabase yapılandırılmamış");
  const summary = { mode: live ? "live" : "dry-run", reason, auth: cfg.authMode, linkMode: cfg.linkMode, todayHasMatch: c.todayHasMatch, candidates: ordered.length + (c.fillers.length ? 1 : 0), posted: [], skipped: [], dryRun: [] };

  if (!live) {
    const seen = new Set();
    const preview = [...ordered, ...c.fillers.slice(0, 1)].filter((item) => { const h = hashKey(item.text); if (seen.has(h)) return false; seen.add(h); return true; }).slice(0, cfg.maxPerRun);
    for (const item of preview) {
      summary.dryRun.push({ key: item.key, kind: item.kind, length: compose.weightedLength(item.text), text: item.text, reply: item.reply || null, ...(item.poll ? { poll: item.poll } : {}) });
      log(`[x-autopost] KURU KOŞU (${summary.reason}) ${item.key} (${compose.weightedLength(item.text)}/280)\n${item.text}${item.poll ? `\n[anket: ${item.poll.options.join(" / ")} · ${item.poll.duration_minutes} dk]` : ""}${item.reply ? `\n  ↳ yanıt: ${item.reply}` : ""}\n---`);
    }
    return summary;
  }

  const db = store || createStore();
  const day = istanbul(now);
  let today = await db.countSince(day.dayStartIso);
  let prematchToday = c.prematch.length ? (await db.countSince(day.dayStartIso, "prematch-poll")) + (await db.countSince(day.dayStartIso, "prematch-ask")) : 0;
  const t0 = clock();
  const throttle = createThrottle({
    safety: cfg.rateSafety,
    seed15m: await db.countSince(new Date(t0 - WINDOW_15M).toISOString()),
    seed24h: await db.countSince(new Date(t0 - WINDOW_24H).toISOString()),
    now: clock
  });
  const seen = await db.existing([...ordered.map((x) => x.key), ...c.fillers.flatMap((f) => [f.key, f.slotKey])]);
  const queue = ordered.filter((x) => !seen.has(x.key));
  const filler = c.fillers.find((f) => !seen.has(f.key) && !seen.has(f.slotKey));
  if (filler && !queue.length) queue.push(filler);

  const send = async (text, opts) => {
    const gate = throttle.check();
    if (!gate.ok) { const e = new Error(`throttle:${gate.reason}`); e.throttled = true; throw e; }
    throttle.record();
    return postTweet(text, cfg.creds, { fetcher, env, tokens, now: clock, ...opts });
  };

  for (const item of queue) {
    if (summary.posted.length >= cfg.maxPerRun) { summary.skipped.push({ key: item.key, reason: "run-cap" }); continue; }
    const gate = throttle.check();
    if (!gate.ok) { summary.skipped.push({ key: item.key, reason: `throttle:${gate.reason}` }); continue; }
    if (today >= cfg.maxPerDay) { summary.skipped.push({ key: item.key, reason: "day-cap" }); continue; }
    const isPrematch = /^prematch-/.test(item.kind);
    if (isPrematch && prematchToday >= cfg.prematch.maxPerDay) { summary.skipped.push({ key: item.key, reason: "prematch-day-cap" }); continue; }
    if (compose.weightedLength(item.text) > compose.MAX_WEIGHT) { summary.skipped.push({ key: item.key, reason: "too-long" }); continue; }
    if (!(await db.claim(item))) { summary.skipped.push({ key: item.key, reason: "already-claimed" }); continue; }
    // İçerik tekrarı: aynı (normalize) metin daha önce gönderildiyse/gönderimdeyse atla.
    const hKey = hashKey(item.text);
    if (!(await db.claim({ key: hKey, kind: "content-hash", text: item.key }))) {
      await db.finish({ key: item.key, status: "skipped", error: "duplicate-content" });
      summary.skipped.push({ key: item.key, reason: "duplicate-content" }); continue;
    }
    if (item.slotKey && !(await db.claim({ key: item.slotKey, kind: "filler-slot", text: item.key }))) {
      await db.finish({ key: item.key, status: "skipped", error: "slot-taken" }); await db.release(hKey);
      summary.skipped.push({ key: item.key, reason: "slot-taken" }); continue;
    }
    today += 1; if (isPrematch) prematchToday += 1;
    let id;
    try {
      id = await send(item.text, { poll: item.poll || null });
      await db.finish({ key: item.key, status: "posted", tweetId: id });
      await db.finish({ key: hKey, status: "hash", tweetId: id }); // pencere sayımına girmez
      summary.posted.push({ key: item.key, id });
      log(`[x-autopost] paylaşıldı ${item.key} → ${id}`);
    } catch (error) {
      // Kalıcı hata (ör. 403 duplicate) tekrar DENENMEZ.
      // Kota/yetki/geçici hata/kısıcı: anahtar bırakılır, sonraki koşu yeniden dener.
      const transient = error.throttled || error.status === 429 || error.status === 401 || !error.status || error.status >= 500;
      if (transient) { await db.release(item.key); await db.release(hKey); if (item.slotKey) await db.release(item.slotKey); today -= 1; if (isPrematch) prematchToday -= 1; }
      else { await db.finish({ key: item.key, status: "failed", error: error.message }); await db.finish({ key: hKey, status: "hash" }); }
      if (error.status === 429) { throttle.block(clock() + (error.waitMs || WINDOW_15M)); summary.retryAfterMs = error.waitMs; }
      summary.skipped.push({ key: item.key, reason: error.message });
      log(`[x-autopost] hata ${item.key}: ${error.message}`);
      if (transient || error.status === 403) break; // kota/yetki: koşuyu durdur
      continue;
    }
    // Bağlantı yanıtı (X_LINK_MODE=reply): ayrı istek, ayrı anahtar (`reply:<anahtar>`).
    if (item.reply && id) {
      const rKey = `reply:${item.key}`;
      if (!(await db.claim({ key: rKey, kind: "reply", text: item.reply }))) continue;
      try {
        const rid = await send(item.reply, { replyTo: id });
        await db.finish({ key: rKey, status: "posted", tweetId: rid });
        (summary.replies = summary.replies || []).push({ key: rKey, id: rid, replyTo: id });
      } catch (error) {
        // Yanıt tekrar denenmez (ana gönderi zaten yayında; ikinci kez yanıt riskine girilmez).
        await db.finish({ key: rKey, status: "failed", error: error.message });
        if (error.status === 429) { throttle.block(clock() + (error.waitMs || WINDOW_15M)); summary.retryAfterMs = error.waitMs; }
        summary.skipped.push({ key: rKey, reason: error.message });
        log(`[x-autopost] yanıt hatası ${rKey}: ${error.message}`);
        if (error.throttled || error.status === 429) break;
      }
    }
  }
  return summary;
}

module.exports = { config, buildCandidates, runXAutopost, postTweet, finalize, loadFromSite, loadFromDisk, istanbul, TWEET_ENDPOINT, FILLER_SLOTS, DATA_FILES };
