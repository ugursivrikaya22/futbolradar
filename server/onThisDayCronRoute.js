const crypto = require("crypto");
const supabaseEnv = require("../services/supabase/env");
const seed = require("../data/on-this-day.json");

/**
 * TARİHTE BUGÜN GÜNLÜK CRON — `GET /api/cron-on-this-day`.
 *
 * vercel.json `crons` her gün 00:00 UTC'de çağırır (Vercel, CRON_SECRET
 * tanımlıysa `Authorization: Bearer <CRON_SECRET>` gönderir).
 *
 *  1. Bugünün (Europe/Istanbul) olaylarını Supabase `on_this_day`'den okur
 *     (yalnız verified=true); okuyamazsa data/on-this-day.json'a düşer.
 *  2. Site statik derlendiği için sayfayı yenilemenin yolu yeniden derlemedir:
 *     ON_THIS_DAY_DEPLOY_HOOK_URL tanımlıysa Vercel Deploy Hook'unu tetikler;
 *     yoksa bunu yanıtta açıkça söyler (ISR yok, deploy hook depoda yok).
 *
 * ASLA web'den olay çekmez, ASLA bir yere yazmaz. Doğrulanmamış veya kaynaksız
 * kayıt yanıtta bile yer almaz.
 */

const CATEGORIES = new Set(["mac", "gol", "transfer", "rekor", "dogum", "olum"]);
const TIMEOUT_MS = 6000;

function tokensMatch(expected, provided) {
  if (!expected || !provided) return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(a, b);
}

function istanbulMonthDay(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { month: Number(p.month), day: Number(p.day) };
}

function publishable(e) {
  return Boolean(e) && e.verified === true && CATEGORIES.has(e.category)
    && /^https:\/\/\S+$/.test(String(e.source_url || "")) && String(e.title_tr || "").trim().length > 0;
}

function fromSeed(month, day, doc = seed) {
  return (Array.isArray(doc?.events) ? doc.events : []).filter((e) => e.month === month && e.day === day && publishable(e));
}

async function fromSupabase(month, day, fetchImpl = fetch) {
  const url = supabaseEnv.restUrl();
  const key = supabaseEnv.serviceKey() || supabaseEnv.anonKey();
  if (!url || !key) return null;
  const q = `${url}/rest/v1/on_this_day?select=id,month,day,year,category,title_tr,description_tr,teams,source_url,source_name,verified&month=eq.${month}&day=eq.${day}&verified=is.true&order=year.asc`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(q, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ctrl.signal });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.filter(publishable) : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function triggerRebuild(fetchImpl = fetch) {
  const hook = String(process.env.ON_THIS_DAY_DEPLOY_HOOK_URL || "").trim();
  if (!/^https:\/\/api\.vercel\.com\/v1\/integrations\/deploy\//.test(hook)) {
    return { mode: "none", triggered: false, note: "ON_THIS_DAY_DEPLOY_HOOK_URL tanımlı değil; ISR yok. Sayfa bir sonraki derlemede yenilenir." };
  }
  try {
    const res = await fetchImpl(hook, { method: "POST" });
    return { mode: "deploy-hook", triggered: res.ok, status: res.status };
  } catch (error) {
    return { mode: "deploy-hook", triggered: false, note: "deploy hook isteği başarısız" };
  }
}

async function handleOnThisDayCron(req, res, deps = {}) {
  const send = (status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); };
  if (req.method !== "GET") return send(405, { ok: false, error: "method" });
  const secret = String(process.env.CRON_SECRET || "");
  if (!secret) return send(503, { ok: false, error: "CRON_SECRET tanımlı değil" });
  const header = String((req.headers && req.headers.authorization) || "");
  const token = (header.match(/^Bearer\s+(.+)$/i) || [])[1] || "";
  if (!tokensMatch(secret, token.trim())) return send(401, { ok: false, error: "yetkisiz" });

  const fetchImpl = deps.fetch || fetch;
  const { month, day } = deps.today || istanbulMonthDay();
  let events = await fromSupabase(month, day, fetchImpl);
  let source = "supabase";
  if (!events) { events = fromSeed(month, day, deps.seed); source = "seed-json"; }
  const rebuild = await triggerRebuild(fetchImpl);
  return send(200, { ok: true, month, day, source, count: events.length, events: events.map((e) => ({ id: e.id, year: e.year, category: e.category, title_tr: e.title_tr, source_url: e.source_url })), rebuild });
}

module.exports = { handleOnThisDayCron, fromSeed, publishable, istanbulMonthDay };
