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
 * SIRA: favori takım golleri → maç sonuçları → köşe yazıları → (maçsız gün) dolgu.
 * Tavanlar: koşu başına X_MAX_PER_RUN (4), günlük X_MAX_PER_DAY (8).
 * MALİYET: X API'de ücretsiz katman yok; bağlantılı gönderi $0.20, bağlantısız
 * $0.015. X_INCLUDE_LINKS=0 bağlantıyı çıkarır (bkz. docs/x-autopost.md).
 */
const compose = require("./compose");
const engagement = require("./engagement");
const { authorizationHeader } = require("./oauth1");
const { createStore } = require("./store");
const { normalizeName } = require("../teamIdentity");

const TWEET_ENDPOINT = "https://api.x.com/2/tweets";
const DEFAULT_FAVORITES = ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"];
const RESULT_WINDOW_MS = 6 * 3600e3;      // maç sonu: başlama + 6 sa içinde
const GOAL_WINDOW_MS = 3 * 3600e3;        // gol: canlı ya da başlama + 3 sa içinde
const COLUMN_WINDOW_MS = 48 * 3600e3;     // köşe yazısı: son 48 sa
const TRANSFER_WINDOW_DAYS = 7;

/** Maçsız günde dolgu saatleri (İstanbul): 12:xx ve 19:xx. */
const FILLER_SLOTS = [{ id: "noon", hour: 12, prefer: ["transfers", "topAssists", "topScorers"] }, { id: "evening", hour: 19, prefer: ["topScorers", "transfers", "topAssists"] }];

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
  const missing = Object.entries({ X_API_KEY: creds.consumerKey, X_API_SECRET: creds.consumerSecret, X_ACCESS_TOKEN: creds.token, X_ACCESS_TOKEN_SECRET: creds.tokenSecret }).filter(([, v]) => !v).map(([k]) => k);
  const num = (v, d, max) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : d; };
  const favorites = String(env.X_FAVORITE_TEAMS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    creds, enabled, missing,
    live: enabled && missing.length === 0,
    maxPerRun: num(env.X_MAX_PER_RUN, 4, 10),
    maxPerDay: num(env.X_MAX_PER_DAY, 8, 50),
    // X pay-per-use: bağlantılı gönderi $0.20, bağlantısız $0.015 (docs.x.com/x-api/getting-started/pricing).
    includeLinks: !/^(0|false|no|off)$/i.test(String(env.X_INCLUDE_LINKS || "").trim()),
    favorites: (favorites.length ? favorites : DEFAULT_FAVORITES).map(normalizeName),
    engagement: engagement.engagementConfig(env)
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
function buildCandidates({ calendar, seoIndex, columns, transfers, leaders }, { now = new Date(), favorites = DEFAULT_FAVORITES.map(normalizeName), engagementCfg = engagement.engagementConfig({}) } = {}) {
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
  const goals = []; const results = []; const prematch = []; const followups = [];
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
    // ETKİLEŞİM (X_ENGAGEMENT_ENABLED): favori takım maçından 60–90 dk önce anket/soru,
    // maç bitince "Tahminini tutturan var mı?" takibi. Aynı takvim + aynı seçim, ek istek yok.
    if (engagementCfg.enabled && isFav) {
      const until = kick - t;
      if (!finished && !LIVE.test(status(m)) && !m.live && until <= engagement.PREMATCH_FROM_MS && until >= engagement.PREMATCH_TO_MS) {
        const c = engagement.composePrematch(m, slug, { now, polls: engagementCfg.polls, links: engagementCfg.links });
        if (c) prematch.push({ ...c, at: kick });
      }
      if (engagementCfg.followup && finished && t - kick >= 0 && t - kick <= RESULT_WINDOW_MS) {
        const c = engagement.composeFollowup(m, slug, { links: engagementCfg.links });
        if (c) followups.push({ ...c, at: kick });
      }
    }
    if (isFav && !finished && (LIVE.test(status(m)) || m.live) && t - kick <= GOAL_WINDOW_MS) {
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
        topAssists: () => compose.composeLeaderStat(leaders, "topAssists")
      };
      for (const id of slot.prefer) {
        const c = options[id]();
        // slotKey: aynı gün aynı saatte ikinci dolgu yok; içerik anahtarı: aynı tablo iki kez yok.
        if (c) fillers.push({ ...c, slotKey: `slot:${today}:${slot.id}` });
      }
    }
  }
  results.sort((a, b) => a.at - b.at);
  prematch.sort((a, b) => a.at - b.at);
  followups.sort((a, b) => a.at - b.at);
  return { goals, results, prematch, followups, columns: cols, fillers, todayHasMatch };
}

async function postTweet(text, creds, { fetcher = fetch, poll = null } = {}) {
  const auth = authorizationHeader({ method: "POST", url: TWEET_ENDPOINT, ...creds });
  const response = await fetcher(TWEET_ENDPOINT, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(engagement.tweetPayload({ text, poll })),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`x-http-${response.status}: ${String(body && (body.detail || body.title) || "").slice(0, 160)}`);
    error.status = response.status;
    throw error;
  }
  return body && body.data && body.data.id;
}

const DATA_FILES = {
  calendar: "data/fixture-calendar.json",
  seoIndex: "data/match-seo-index.json",
  columns: "data/columns.json",
  transfers: "data/transfers.json",
  leaders: "data/league-leaders.json"
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

/**
 * Bir koşu. Dönen: { mode, posted[], skipped[], dryRun[] }.
 * `store`/`fetcher`/`data` testte enjekte edilir.
 */
async function runXAutopost({ env = process.env, now = new Date(), data, loader = loadFromSite, store, fetcher = fetch, log = console.log } = {}) {
  const cfg = config(env);
  const live = cfg.live && (store || supabaseConfigured());
  const input = data || await loader({ fetcher });
  const c = buildCandidates(input, { now, favorites: cfg.favorites, engagementCfg: cfg.engagement });
  if (!cfg.includeLinks) {
    const strip = (item) => ({ ...item, text: item.text.replace(/\n*https?:\/\/\S+\s*$/, "").trim() });
    for (const k of ["goals", "results", "prematch", "followups", "columns", "fillers"]) c[k] = c[k].map(strip);
  }
  const ordered = [...c.goals, ...c.results, ...c.prematch, ...c.followups, ...c.columns];
  const summary = { mode: live ? "live" : "dry-run", reason: live ? null : (!cfg.enabled ? "X_AUTOPOST_ENABLED kapalı" : cfg.missing.length ? `eksik: ${cfg.missing.join(",")}` : "Supabase yapılandırılmamış"), todayHasMatch: c.todayHasMatch, candidates: ordered.length + (c.fillers.length ? 1 : 0), posted: [], skipped: [], dryRun: [] };

  if (!live) {
    const preview = [...ordered, ...c.fillers.slice(0, 1)].slice(0, cfg.maxPerRun);
    for (const item of preview) {
      summary.dryRun.push({ key: item.key, kind: item.kind, length: compose.weightedLength(item.text), text: item.text, ...(item.poll ? { poll: item.poll } : {}) });
      log(`[x-autopost] KURU KOŞU (${summary.reason}) ${item.key} (${compose.weightedLength(item.text)}/280)\n${item.text}${item.poll ? `\n[anket: ${item.poll.options.join(" / ")} · ${item.poll.duration_minutes} dk]` : ""}\n---`);
    }
    return summary;
  }

  const db = store || createStore();
  const day = istanbul(now);
  let today = await db.countSince(day.dayStartIso);
  const seen = await db.existing([...ordered.flatMap((x) => (x.requires ? [x.key, x.requires] : [x.key])), ...c.fillers.flatMap((f) => [f.key, f.slotKey])]);
  // Takip gönderisi yalnızca maç öncesi gönderisi gerçekten paylaşılmışsa.
  const queue = ordered.filter((x) => !seen.has(x.key) && (!x.requires || seen.has(x.requires)));
  const filler = c.fillers.find((f) => !seen.has(f.key) && !seen.has(f.slotKey));
  if (filler && !queue.length) queue.push(filler);

  for (const item of queue) {
    if (summary.posted.length >= cfg.maxPerRun) { summary.skipped.push({ key: item.key, reason: "run-cap" }); continue; }
    if (today >= cfg.maxPerDay) { summary.skipped.push({ key: item.key, reason: "day-cap" }); continue; }
    if (compose.weightedLength(item.text) > compose.MAX_WEIGHT) { summary.skipped.push({ key: item.key, reason: "too-long" }); continue; }
    if (!(await db.claim(item))) { summary.skipped.push({ key: item.key, reason: "already-claimed" }); continue; }
    if (item.slotKey && !(await db.claim({ key: item.slotKey, kind: "filler-slot", text: item.key }))) {
      await db.finish({ key: item.key, status: "skipped", error: "slot-taken" });
      summary.skipped.push({ key: item.key, reason: "slot-taken" }); continue;
    }
    today += 1;
    try {
      const id = await postTweet(item.text, cfg.creds, { fetcher, poll: item.poll || null });
      await db.finish({ key: item.key, status: "posted", tweetId: id });
      summary.posted.push({ key: item.key, id });
      log(`[x-autopost] paylaşıldı ${item.key} → ${id}`);
    } catch (error) {
      // Kalıcı hata (ör. 403 duplicate) tekrar DENENMEZ.
      // Kota/yetki/geçici hata: anahtar bırakılır, sonraki koşu yeniden dener.
      const transient = error.status === 429 || error.status === 401 || !error.status || error.status >= 500;
      if (transient) { await db.release(item.key); if (item.slotKey) await db.release(item.slotKey); today -= 1; }
      else await db.finish({ key: item.key, status: "failed", error: error.message });
      summary.skipped.push({ key: item.key, reason: error.message });
      log(`[x-autopost] hata ${item.key}: ${error.message}`);
      if (transient || error.status === 403) break; // kota/yetki: koşuyu durdur
    }
  }
  return summary;
}

module.exports = { config, buildCandidates, runXAutopost, postTweet, loadFromSite, loadFromDisk, istanbul, TWEET_ENDPOINT, FILLER_SLOTS, DATA_FILES };
