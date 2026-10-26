/**
 * PUSH OLAY TEKİLLEŞTİRME VE PAYLAŞILAN CANLI ANLIK GÖRÜNTÜ — SUPABASE.
 *
 * Şema: supabase/migrations/0013_push_event_dedup.sql. Desen
 * services/pushSubscriptionStore.js ile aynı (PostgREST'e düz fetch).
 *
 * Supabase yapılandırılmamışsa her şey zararsız no-op: `claimEvent` "açık"
 * döner (eski davranış: tekilleştirme yok), anlık görüntü okunamaz.
 */
const { isConfigured, restUrl, serviceKey } = require("./supabase/env");

const DEDUP_TABLE = "push_event_dedup";
const SNAPSHOT_TABLE = "push_live_snapshots";
const REQUEST_TIMEOUT_MS = 4000;

async function request(pathname, options = {}, fetchImpl = globalThis.fetch) {
  const base = restUrl();
  const key = serviceKey();
  if (!base || !key) throw new Error("push-event-store-not-configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}/rest/v1/${pathname}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`push-event-store-http-${response.status}`);
    return raw ? JSON.parse(raw) : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Olayı talep et. `true` → bu örnek gönderir; `false` → başka örnek zaten
 * gönderdi. Depo yoksa ya da hata olursa `true` (bildirim kaybetmektense
 * nadir bir çift bildirim; bkz. PR açıklaması).
 */
async function claimEvent(eventKey, meta = {}, fetchImpl) {
  if (!isConfigured()) return true;
  try {
    const rows = await request(`${DEDUP_TABLE}?on_conflict=event_key`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ event_key: String(eventKey).slice(0, 400), fixture_id: meta.fixtureId || null, event_type: meta.type || "unknown" })
    }, fetchImpl);
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    return true;
  }
}

async function writeSnapshot(id, matches, fetchedAt, fetchImpl) {
  if (!isConfigured()) return false;
  await request(`${SNAPSHOT_TABLE}?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, matches: Array.isArray(matches) ? matches : [], fetched_at: fetchedAt || null, updated_at: new Date().toISOString() })
  }, fetchImpl);
  return true;
}

async function readSnapshot(id, fetchImpl) {
  if (!isConfigured()) return null;
  const rows = await request(`${SNAPSHOT_TABLE}?id=eq.${encodeURIComponent(id)}&select=matches,fetched_at`, { method: "GET" }, fetchImpl);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? { matches: Array.isArray(row.matches) ? row.matches : [], fetchedAt: row.fetched_at || null } : null;
}

// Sağlayıcı yanıtı başına en fazla bir yazma; sıcak örnekte 15 sn'de bir.
const RECORD_MIN_INTERVAL_MS = 10000;
let lastRecordedAt = 0;
let lastRecordedFetchedAt = null;

/**
 * Sitenin ZATEN yaptığı `live=all` isteğinin sonucunu paylaşılan depoya
 * yazar (services/providers/apiFootballProvider.js çağırır). Ateşle-unut:
 * hata canlı skor hattını asla etkilemez. Sağlayıcıya ek istek YOK.
 */
function recordLiveFixtures(rows, now = Date.now()) {
  if (!isConfigured() || !Array.isArray(rows)) return;
  const fetchedAt = rows.map((row) => row && row.fetchedAt).filter(Boolean).sort().slice(-1)[0] || null;
  if (fetchedAt && fetchedAt === lastRecordedFetchedAt) return;
  if (now - lastRecordedAt < RECORD_MIN_INTERVAL_MS) return;
  lastRecordedAt = now;
  lastRecordedFetchedAt = fetchedAt;
  try {
    // eslint-disable-next-line global-require
    const { isLiveMatch, matchSnapshot } = require("./liveScoreStream");
    const receivedAt = new Date(now).toISOString();
    const matches = rows.filter(isLiveMatch).map((row) => matchSnapshot(row, receivedAt));
    writeSnapshot("live", matches, fetchedAt || receivedAt).catch(() => {});
  } catch (error) {
    /* sessiz */
  }
}

function resetRecorder() {
  lastRecordedAt = 0;
  lastRecordedFetchedAt = null;
}

module.exports = { DEDUP_TABLE, SNAPSHOT_TABLE, claimEvent, readSnapshot, recordLiveFixtures, resetRecorder, writeSnapshot };
