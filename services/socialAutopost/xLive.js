/**
 * X CANLI MAÇ TWEETLERİ — kind "live" (`x_autopost_posts`).
 *
 * VERİ (YENİ API-FOOTBALL İSTEĞİ YOK):
 *  1) Yayımlanmış `data/fixture-calendar.json` olayları — mevcut x-autopost'un
 *     her 15 dk'da zaten indirdiği dosya; cron'da AYNI indirme paylaşılır.
 *     Olay türleri `match-notifications-core.js#events` ile (web push ile aynı
 *     olay kimliği): goal, penalty_scored, penalty_missed, penalty_awarded,
 *     red_card, var (gol iptali). Devre arası (HT) durumu da tweetlenir.
 *  2) İSTEĞE BAĞLI (X_LIVE_STATS_ENABLED=1): Supabase `live_pulse_samples`
 *     (0006) — maç detay sayfası canlı açıldığında zaten kaydedilen KÜMÜLATİF
 *     istatistik anlık görüntüleri. Son iki görüntü arasında "Korner" ya da
 *     "İsabetli şut" artmışsa korner / pozisyon tweeti. Sağlayıcıda dakikalı
 *     korner/şut olayı YOK; bu yalnızca iki ölçüm arasındaki farktır ve
 *     yalnızca o maç sayfası ziyaret edildiyse veri vardır.
 *
 * DEDUP: anahtar = maç kimliği + olay türü + dakika + oyuncu/takım
 * (`notificationCore.events` kimliği). Goller x-autopost ile AYNI anahtarı
 * (`goal:<olay>`) kullanır → aynı gol iki iş tarafından iki kez atılmaz.
 * Diğerleri `live:<olay>`.
 * TAVAN: koşu başına X_LIVE_MAX_PER_RUN (3), maç başına X_LIVE_MAX_PER_MATCH (6),
 * günlük (İstanbul) X_LIVE_MAX_PER_DAY (15). Varsayılan KURU KOŞU (X_LIVE_ENABLED).
 */
const notificationCore = require("../../match-notifications-core.js");
const xAutopost = require("../xAutopost");
const { createStore } = require("../xAutopost/store");
const { SITE, MAX_WEIGHT, weightedLength } = require("../xAutopost/compose");
const { normalizeName } = require("../teamIdentity");
const { on, int, supabaseConfigured } = require("./common");

const KIND = "live";
const LIVE = /^(LIVE|IN_PLAY|1H|2H|ET|HT|BT|P|PAUSED|INT)$/i;
const HALF_TIME = /^(HT|PAUSED|HALFTIME)$/i;
const FINISHED = /^(FINISHED|FT|AET|PEN)$/i;
const LIVE_WINDOW_MS = 3.5 * 3600e3;

function config(env = process.env) {
  const x = xAutopost.config(env);
  const enabled = on(env.X_LIVE_ENABLED);
  return {
    creds: x.creds, missing: x.missing, enabled, favorites: x.favorites,
    live: enabled && !x.killed && x.missing.length === 0, marker: x.marker,
    stats: on(env.X_LIVE_STATS_ENABLED),
    favoritesOnly: !/^(0|false|no|off)$/i.test(String(env.X_LIVE_FAVORITES_ONLY || "").trim()),
    maxPerRun: int(env.X_LIVE_MAX_PER_RUN, 3, 1, 10),
    maxPerMatch: int(env.X_LIVE_MAX_PER_MATCH, 6, 1, 20),
    maxPerDay: int(env.X_LIVE_MAX_PER_DAY, 15, 1, 50)
  };
}

function statusOf(m) { return String(m.providerStatus || m.status || ""); }
function minuteLabel(e) { return e.minute != null && e.minute !== "" ? `${e.minute}${e.extraMinute ? `+${e.extraMinute}` : ""}'` : ""; }
function scoreLine(m) { const s = m.score; return s && Number.isFinite(s.home) && Number.isFinite(s.away) ? `${m.homeTeam} ${s.home}-${s.away} ${m.awayTeam}` : `${m.homeTeam} - ${m.awayTeam}`; }
function player(raw) { return String(raw || "").split("·")[0].trim(); }

function slugFor(m, index) {
  const ids = m.providerIds || {};
  const af = ids.apiFootball || (/api-football/i.test(String(m.providerName || m.source || "")) ? m.providerId : null);
  return { af: af ? String(af) : null, slug: (af && index[`af:${af}`]) || (ids.theSportsDb && index[`tsdb:${ids.theSportsDb}`]) || null };
}

const LABEL = {
  goal: "⚽ GOL!", penalty_scored: "⚽ GOL! (penaltı)", penalty_missed: "❌ Penaltı kaçtı",
  penalty_awarded: "⚠️ Penaltı kararı", red_card: "🟥 Kırmızı kart", var: "📺 VAR: gol iptal"
};

function composeEvent(m, e, url, { isLatest }) {
  const head = `${LABEL[e.type]} ${e.teamName || ""}`.trim();
  // Skor yalnızca son olayda yazılır (eski olay anındaki skor sağlayıcıda yok).
  const lines = [head, isLatest ? scoreLine(m) : `${m.homeTeam} - ${m.awayTeam}`, [player(e.playerName), minuteLabel(e)].filter(Boolean).join(" ")].filter(Boolean);
  const text = `${lines.join("\n")}\n\n${url}`;
  return weightedLength(text) <= MAX_WEIGHT ? text : `${lines.slice(0, 2).join("\n")}\n\n${url}`;
}

function inScopeFactory(matches, favorites, favoritesOnly) {
  const fav = new Set(favorites);
  const superLig = new Set(favorites);
  for (const m of matches) if (/^Süper Lig$/i.test(String(m.league || "").trim())) { superLig.add(normalizeName(m.homeTeam)); superLig.add(normalizeName(m.awayTeam)); }
  const turkey = (m) => /^türkiye$/i.test(String(m.homeTeam).trim()) || /^türkiye$/i.test(String(m.awayTeam).trim());
  const set = favoritesOnly ? fav : superLig;
  return (m) => set.has(normalizeName(m.homeTeam)) || set.has(normalizeName(m.awayTeam)) || turkey(m);
}

/** Canlı maçlar + olay adayları. Saf: yalnızca girdi ve `now`. */
function buildLiveCandidates({ calendar, seoIndex }, { now = new Date(), favorites, favoritesOnly = true } = {}) {
  const matches = Array.isArray(calendar) ? calendar : (calendar && Array.isArray(calendar.matches) ? calendar.matches : []);
  const index = seoIndex || {};
  const inScope = inScopeFactory(matches, (favorites || []).map(normalizeName), favoritesOnly);
  const t = now.getTime();
  const out = []; const liveMatches = [];
  for (const m of matches) {
    const kick = Date.parse(m.kickoff);
    const st = statusOf(m);
    if (!Number.isFinite(kick) || t < kick || t - kick > LIVE_WINDOW_MS) continue;
    if (FINISHED.test(st) || !(LIVE.test(st) || m.live)) continue; // maç sonu x-autopost'ta (result:)
    if (!inScope(m)) continue;
    const { af, slug } = slugFor(m, index);
    if (!slug) continue; // kalıcı /mac/ sayfası olmayan maç paylaşılmaz
    const url = `${SITE}/mac/${slug}`;
    const matchKey = String(m.id);
    liveMatches.push({ match: m, af, slug, url, matchKey });
    // Olay olay çözülür: sağlayıcı dökümünde oyuncu adı `value` içinde gelir
    // ("Ad · Asist: … · Normal Goal") — x-autopost#goalEvents ile aynı yol.
    const evs = [];
    for (const raw of Array.isArray(m.events) ? m.events : []) {
      const [e] = notificationCore.events({ id: m.id, events: [raw] });
      if (e && LABEL[e.type]) evs.push({ ...e, playerName: e.playerName || player(raw.value) });
    }
    evs.forEach((e, i) => {
      const isGoal = e.type === "goal" || e.type === "penalty_scored";
      out.push({ key: isGoal ? `goal:${e.id}` : `live:${e.id}`, kind: KIND, matchKey, minute: Number.parseInt(e.minute, 10) || 0, type: e.type, text: composeEvent(m, e, url, { isLatest: i === evs.length - 1 }) });
    });
    if (HALF_TIME.test(st)) out.push({ key: `live:${matchKey}:ht`, kind: KIND, matchKey, minute: 45, type: "ht", text: `⏸️ Devre arası\n${scoreLine(m)}\n\n${url}` });
  }
  out.sort((a, b) => a.minute - b.minute);
  return { candidates: out, liveMatches };
}

function statPair(sample, re) {
  const row = (sample && Array.isArray(sample.statistics) ? sample.statistics : []).find((r) => r && re.test(String(r.type || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").toLowerCase()));
  return row && Number.isFinite(Number(row.home)) && Number.isFinite(Number(row.away)) ? { home: Number(row.home), away: Number(row.away) } : null;
}

/** Son iki kümülatif görüntü arasındaki korner / isabetli şut artışları. Saf. */
function statCandidates(lm, samples) {
  if (!Array.isArray(samples) || samples.length < 2) return [];
  const [prev, last] = samples.slice(-2);
  const out = [];
  const kinds = [
    { type: "corner", re: /^(korner|corner kicks|corners)$/, label: "🚩 Korner", noun: "Korner" },
    { type: "chance", re: /^(isabetli sut|shots on goal|shots on target)$/, label: "🎯 Pozisyon (isabetli şut)", noun: "İsabetli şut" }
  ];
  for (const k of kinds) {
    const a = statPair(prev, k.re); const b = statPair(last, k.re);
    if (!a || !b) continue;
    for (const side of ["home", "away"]) {
      if (b[side] <= a[side]) continue;
      const team = side === "home" ? lm.match.homeTeam : lm.match.awayTeam;
      const minute = Math.round(Number(last.minute));
      const range = Math.round(Number(prev.minute)) === minute ? `${minute}'` : `${Math.round(Number(prev.minute))}'-${minute}'`;
      out.push({
        key: `live:${lm.matchKey}:${k.type}:${minute}:${side}`, kind: KIND, matchKey: lm.matchKey, minute, type: k.type,
        text: `${k.label} — ${team} (${range})\n${scoreLine(lm.match)}\n${k.noun}: ${b.home}-${b.away}\n\n${lm.url}`
      });
    }
  }
  return out;
}

async function runXLive({ env = process.env, now = new Date(), data, loader = xAutopost.loadFromSite, store, fetcher = fetch, loadSamples, log = console.log } = {}) {
  const cfg = config(env);
  const live = cfg.live && Boolean(store || supabaseConfigured());
  const input = data || await loader({ fetcher });
  const { candidates, liveMatches } = buildLiveCandidates(input, { now, favorites: cfg.favorites, favoritesOnly: cfg.favoritesOnly });
  if (cfg.stats && liveMatches.length) {
    const reader = loadSamples || require("../livePulseArchive").loadSamples;
    for (const lm of liveMatches) {
      // live_pulse_samples.fixture_id: maç detayının fixtureId'si (API-Football kimliği — doğrulanacak).
      const samples = await reader(lm.af || lm.matchKey).catch(() => []);
      candidates.push(...statCandidates(lm, samples));
    }
  }
  const summary = { mode: live ? "live" : "dry-run", reason: live ? null : (!cfg.enabled ? "X_LIVE_ENABLED kapalı" : cfg.missing.length ? `eksik: ${cfg.missing.join(",")}` : "Supabase yapılandırılmamış"), liveMatches: liveMatches.length, candidates: candidates.length, posted: [], skipped: [], dryRun: [] };
  if (!liveMatches.length) return summary;

  if (!live) {
    for (const c of candidates.slice(0, cfg.maxPerRun)) {
      summary.dryRun.push({ key: c.key, type: c.type, length: weightedLength(c.text), text: c.text });
      log(`[x-live] KURU KOŞU (${summary.reason}) ${c.key}\n${c.text}\n---`);
    }
    return summary;
  }

  const db = store || createStore();
  const day = xAutopost.istanbul(now);
  let today = await db.countSince(day.dayStartIso, KIND);
  const seen = await db.existing(candidates.map((c) => c.key));
  const perMatch = new Map();
  for (const c of candidates) {
    if (seen.has(c.key)) continue;
    if (summary.posted.length >= cfg.maxPerRun) { summary.skipped.push({ key: c.key, reason: "run-cap" }); continue; }
    if (today >= cfg.maxPerDay) { summary.skipped.push({ key: c.key, reason: "day-cap" }); continue; }
    if (!perMatch.has(c.matchKey)) perMatch.set(c.matchKey, (await db.countPrefix(`live:${c.matchKey}:`)) + (await db.countPrefix(`goal:${c.matchKey}:`)));
    if (perMatch.get(c.matchKey) >= cfg.maxPerMatch) { summary.skipped.push({ key: c.key, reason: "match-cap" }); continue; }
    if (weightedLength(c.text) > MAX_WEIGHT) { summary.skipped.push({ key: c.key, reason: "too-long" }); continue; }
    if (!(await db.claim({ key: c.key, kind: KIND, text: c.text }))) { summary.skipped.push({ key: c.key, reason: "already-claimed" }); continue; }
    today += 1; perMatch.set(c.matchKey, perMatch.get(c.matchKey) + 1);
    try {
      const id = await xAutopost.postTweet(require("../xAutopost/compose").applyLinkMode({ text: c.text }, "inline", { marker: cfg.marker }).text, cfg.creds, { fetcher });
      await db.finish({ key: c.key, status: "posted", tweetId: id });
      summary.posted.push({ key: c.key, id });
      log(`[x-live] paylaşıldı ${c.key} → ${id}`);
    } catch (error) {
      const transient = error.status === 429 || error.status === 401 || !error.status || error.status >= 500;
      if (transient) { await db.release(c.key); today -= 1; perMatch.set(c.matchKey, perMatch.get(c.matchKey) - 1); }
      else await db.finish({ key: c.key, status: "failed", error: error.message });
      summary.skipped.push({ key: c.key, reason: error.message });
      log(`[x-live] hata ${c.key}: ${error.message}`);
      if (transient || error.status === 403) break;
    }
  }
  return summary;
}

module.exports = { KIND, LABEL, config, buildLiveCandidates, statCandidates, runXLive };
