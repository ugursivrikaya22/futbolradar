/**
 * PWA PUSH — CANLI MAÇ OLAYLARI İÇİN ZAMANLANMIŞ TETİKLEYİCİ.
 *
 * NEDEN. Gol / maç başı / devre arası / kırmızı kart / maç sonu bildirimleri
 * (`services/pushNotifier.js`) bugüne kadar yalnızca `LiveScoreHub` bir SSE
 * bağlantısıyla yoklarken tetikleniyordu: sitede kimse canlı skoru açık
 * tutmazsa hiçbir bildirim gitmiyordu. Bu iş Vercel Cron'dan
 * (`/api/cron-live-match-push`) çalışır ve aynı olay tespitini
 * (`detectMatchEvents`) ve aynı gönderimi (`notifyMatchEvents`) kullanır.
 *
 * KOTA. Sağlayıcı yalnızca gerektiğinde yoklanır:
 *  1. Günün programı: İstanbul günü başına BİR `/fixtures?date=` isteği;
 *     sonuç `push_reminder_log` içinde `schedule:<gün>` satırına yazılır
 *     ve gün boyunca oradan okunur (yalnızca `data/teams.json` takımlarının
 *     maçları tutulur — Süper Lig kulüpleri, Avrupa maçları dahil).
 *  2. Pencere: başlamaya ≤15 dk kalmış ya da başlama saatinden bu yana
 *     ≤180 dk geçmiş bir maç yoksa sağlayıcıya HİÇ gidilmez.
 *  3. Pencere açıksa tek bir `/fixtures?live=all` isteği (tüm maçlar için).
 *  4. Canlı akıştan düşen (bitti) takipteki maç için bir kez `/fixtures?id=`
 *     — `live=all` biten maçı döndürmediğinden maç sonu ancak böyle görülür.
 *  TheSportsDB kullanılmaz: sağlayıcı doğrudan API-Football bağdaştırıcısıdır.
 *
 * DURUM (sunucusuz). Önceki anlık görüntü `snap:<maç>` satırında saklanır.
 * Her olay deterministik anahtarla (`eventKey`) `push_reminder_log`a ilk
 * INSERT ile alınır; SSE hattı da aynı anahtarı alır (bkz.
 * liveScoreStream.getLiveScoreHub) → aynı olay iki kez gitmez.
 * Tablo yoksa / alınamazsa GÖNDERİLMEZ. VAPID ya da Supabase yoksa skipped.
 * PUSH_LIVE_MATCH_ENABLED=0 kapatır. Yeni tablo/migrasyon YOK (0015 yeterli).
 */
const { detectMatchEvents, isLiveMatch, matchSnapshot } = require("./liveScoreStream");
const { teamIdForName, loadTeams } = require("./teamIdentity");

const LOG_TABLE = "push_reminder_log";
const LEAD_MS = 15 * 60e3;
const TRAIL_MS = 180 * 60e3;
const FINISHED = new Set(["FT", "FINISHED", "AET", "PEN"]);

function config(env = process.env) {
  return {
    enabled: !/^(0|false|no|off)$/i.test(String(env.PUSH_LIVE_MATCH_ENABLED || "").trim()),
    vapidReady: Boolean(String(env.VAPID_PUBLIC_KEY || "").trim() && String(env.VAPID_PRIVATE_KEY || "").trim() && String(env.VAPID_SUBJECT || "").trim())
  };
}

function istanbulDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Olay başına deterministik tekrarsızlık anahtarı (cron ve SSE ortak). */
function eventKey(event) {
  const m = (event && event.match) || {};
  const id = String(m.id || m.providerId || "");
  if (!id) return null;
  const s = m.score || {};
  switch (event.type) {
    case "kickoff": return `kickoff:${id}`;
    case "goal": return `goal:${id}:${s.home ?? ""}-${s.away ?? ""}`;
    case "halftime": return `halftime:${id}`;
    case "fulltime": return `fulltime:${id}`;
    case "red-card": return `red:${id}:${m.minute ?? ""}`;
    default: return null;
  }
}

function isTracked(match, teams) {
  return Boolean(teamIdForName(match && match.homeTeam, teams) || teamIdForName(match && match.awayTeam, teams));
}

/** Saf: şu an sağlayıcı yoklanmalı mı? */
function inWindow(schedule, now) {
  const t = now.getTime();
  return (schedule || []).some((k) => {
    const kick = Date.parse(k.kickoff);
    return Number.isFinite(kick) && t >= kick - LEAD_MS && t <= kick + TRAIL_MS;
  });
}

/** Saklanacak küçük önceki-durum: detectMatchEvents'in baktığı alanlar. */
function compactSnapshot(s) {
  return {
    id: s.id, providerId: s.providerId, homeTeam: s.homeTeam, awayTeam: s.awayTeam, kickoff: s.kickoff,
    status: s.status, providerStatus: s.providerStatus, minute: s.minute, live: s.live,
    score: { home: s.score.home, away: s.score.away },
    events: (s.events || []).filter((e) => /red card|second yellow/i.test(String(e.detail || ""))).map((e) => ({ detail: e.detail }))
  };
}

/**
 * Saf: önceki durum yokken (ilk gözlem) bayat olayları ele.
 * İlk gözlemde önceki durum "başlamadı, 0-0" sayılır; ama maç zaten
 * bitmiş görünüyorsa gol/kırmızı kart/maç başı gönderilmez (yalnızca maç sonu),
 * maç ilerlemiş (>20') görünüyorsa maç başı gönderilmez.
 */
function eventsFor(prev, current) {
  const base = prev || { id: current.id, live: false, status: "NS", providerStatus: "NS", score: { home: 0, away: 0 }, events: [] };
  const events = detectMatchEvents(new Map([[current.id, base]]), [current], true);
  if (prev) return events;
  const finished = FINISHED.has(String(current.providerStatus || current.status || "").toUpperCase());
  return events.filter((e) => {
    if (finished) return e.type === "fulltime";
    if (e.type === "kickoff") return !(Number(current.minute) > 20);
    return true;
  });
}

function createStore({ request } = {}) {
  const req = request || require("./supabase/client").request;
  async function read(key) {
    const rows = await req(`${LOG_TABLE}?reminder_key=eq.${encodeURIComponent(key)}&select=info`, { method: "GET" });
    if (!Array.isArray(rows) || !rows.length || !rows[0].info) return null;
    try { return JSON.parse(rows[0].info); } catch (error) { return null; }
  }
  async function write(key, kind, value) {
    await req(`${LOG_TABLE}?on_conflict=reminder_key`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ reminder_key: key, kind, info: JSON.stringify(value) }])
    });
  }
  return {
    read, write,
    /** İlk INSERT kazanır; true = bu çağıran gönderebilir. */
    async claim(key, info) {
      const rows = await req(`${LOG_TABLE}?on_conflict=reminder_key`, {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify([{ reminder_key: key, kind: "live-event", info: String(info || "").slice(0, 200) }])
      });
      return Array.isArray(rows) && rows.length > 0;
    }
  };
}

/** Olayları anahtarla alır; alınamayanları (zaten gönderilmiş) eler. */
async function claimEvents(events, store) {
  const out = [];
  for (const e of events) {
    const key = eventKey(e);
    if (!key) continue;
    if (await store.claim(key, `${e.match.homeTeam} - ${e.match.awayTeam}`)) out.push(e);
  }
  return out;
}

function defaultProvider() {
  // eslint-disable-next-line global-require
  return require("./providers/apiFootballProvider");
}

/**
 * Bir koşu. Dönen: { status, reason?, polled, matches, events, sent }.
 * `provider`, `store`, `notify`, `teams`, `subscriptionsConfigured` testte enjekte edilir.
 */
async function runLiveMatchPush({ env = process.env, now = new Date(), provider, store, notify, teams, subscriptionsConfigured } = {}) {
  const cfg = config(env);
  if (!cfg.enabled) return { status: "skipped", reason: "PUSH_LIVE_MATCH_ENABLED=0" };
  if (!cfg.vapidReady) return { status: "skipped", reason: "vapid-not-configured" };
  const subsReady = typeof subscriptionsConfigured === "boolean" ? subscriptionsConfigured : require("./pushSubscriptionStore").isConfigured();
  if (!subsReady) return { status: "skipped", reason: "supabase-not-configured" };

  const db = store || createStore();
  const api = provider || defaultProvider();
  const send = notify || require("./pushNotifier").notifyMatchEvents;
  const teamList = teams || loadTeams();
  const day = istanbulDate(now);

  // 1) Günün programı (gün başına bir sağlayıcı isteği).
  let schedule;
  try { schedule = await db.read(`schedule:${day}`); } catch (error) {
    return { status: "skipped", reason: `log-unavailable: ${String(error.message).slice(0, 80)}` };
  }
  if (!Array.isArray(schedule)) {
    const rows = await api.getFixtures({ date: day });
    schedule = (rows || []).filter((m) => isTracked(m, teamList)).map((m) => ({ id: String(m.id || m.providerId || ""), kickoff: m.kickoff }));
    await db.write(`schedule:${day}`, "live-schedule", schedule);
  }

  // 2) Pencere kapalıysa sağlayıcıya gitme.
  if (!inWindow(schedule, now)) return { status: "complete", polled: false, matches: 0, events: 0 };

  // 3) Tek canlı istek.
  const serverReceivedAt = now.toISOString();
  const liveRows = (await api.getFixtures({ live: "all" }) || []).filter((m) => isTracked(m, teamList));
  const current = liveRows.filter(isLiveMatch).map((m) => matchSnapshot(m, serverReceivedAt));
  const seen = new Set(current.map((m) => m.id));

  // 4) Canlıdan düşen takipteki maç: bir kez kimlikle sor (maç sonu için).
  for (const k of schedule) {
    if (!k.id || seen.has(k.id)) continue;
    const prev = await db.read(`snap:${k.id}`);
    if (!prev || !prev.live) continue;
    const rows = await api.getFixtures({ id: k.id }).catch(() => []);
    const m = (rows || [])[0];
    if (m) { current.push(matchSnapshot(m, serverReceivedAt)); seen.add(k.id); }
  }

  let all = [];
  for (const snap of current) {
    const prev = await db.read(`snap:${snap.id}`);
    all = all.concat(eventsFor(prev, snap));
    await db.write(`snap:${snap.id}`, "live-snapshot", compactSnapshot(snap));
  }

  const fresh = await claimEvents(all, db);
  if (fresh.length) await send(fresh);
  return { status: "complete", polled: true, matches: current.length, events: fresh.length, duplicates: all.length - fresh.length };
}

module.exports = { LOG_TABLE, config, eventKey, inWindow, eventsFor, compactSnapshot, createStore, claimEvents, runLiveMatchPush, istanbulDate };
