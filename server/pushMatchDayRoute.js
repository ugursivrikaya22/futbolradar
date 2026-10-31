/**
 * MAÇ GÜNÜ HATIRLATMASI UÇ NOKTASI — GET /api/push-match-day
 *
 *   Authorization: Bearer <CRON_SECRET>   (zorunlu; yoksa 401, sır tanımlı değilse 503)
 *   ?dryRun=1                             hiçbir şey göndermeden planı döner
 *
 * YENİ CRON YOK. vercel.json'daki tek cron (`/api/cron-on-this-day`,
 * 00:00 UTC = 03:00 TR) hatırlatma için kötü bir saat. Bu uç nokta
 * dışarıdan, günde bir kez (önerilen 10:00 TR) bir zamanlayıcıyla
 * çağrılmak üzere tasarlandı. Aynı gün ikinci çağrı aynı aboneye ikinci
 * bildirim göndermez (`last_match_day_on`, migrasyon 0014) ve cihazda da
 * `matchday-<maç>` etiketiyle tekilleşir.
 */
const crypto = require("crypto");
const { todaysMatches, istanbulDate } = require("../services/matchDayFixtures");
const pushNotifier = require("../services/pushNotifier");
const { loadTeams } = require("../services/teamIdentity");

function tokensMatch(expected, provided) {
  if (!expected || !provided) return false;
  const a = crypto.createHash("sha256").update(expected).digest();
  const b = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(a, b);
}

async function handlePushMatchDay(req, res, deps = {}) {
  const send = (status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); };
  if (req.method !== "GET" && req.method !== "POST") return send(405, { ok: false, error: "method" });
  const secret = String(process.env.CRON_SECRET || "");
  if (!secret) return send(503, { ok: false, error: "CRON_SECRET tanımlı değil" });
  const header = String((req.headers && req.headers.authorization) || "");
  const token = (header.match(/^Bearer\s+(.+)$/i) || [])[1] || "";
  if (!tokensMatch(secret, token.trim())) return send(401, { ok: false, error: "yetkisiz" });

  const url = new URL(req.url || "/", "http://localhost");
  const dryRun = /^(1|true|yes)$/i.test(url.searchParams.get("dryRun") || "");
  const today = deps.today || istanbulDate(deps.now || new Date());
  const matches = todaysMatches({ today, fixtures: deps.fixtures, teams: loadTeams() });

  if (!dryRun && !(deps.isConfigured || pushNotifier.isConfigured)()) {
    return send(503, { ok: false, error: "push yapılandırılmamış (VAPID / Supabase)", today, matches: matches.length });
  }
  const result = await pushNotifier.sendMatchDayReminders({ matches, today, dryRun, store: deps.store, send: deps.send });
  return send(200, { ok: true, ...result });
}

module.exports = { handlePushMatchDay };
