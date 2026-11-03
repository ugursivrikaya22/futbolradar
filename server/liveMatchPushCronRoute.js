/**
 * CANLI MAÇ PUSH CRON'U — `GET /api/cron-live-match-push`.
 *
 * `/api/cron/<iş>` işlevinde DEĞİL, catch-all'da: o işlevin paketinden
 * `data/**` çıkarılıyor (vercel.json excludeFiles), API-Football
 * bağdaştırıcısı ise `data/operations-policy.json` ve `data/teams.json`
 * gerektiriyor. SSE canlı skor hattı da aynı catch-all'da çalışıyor.
 * Doğrulama `/api/cron/*` ile birebir aynı: `server/cronAuth.js` (CRON_SECRET).
 */
const { verifyCronRequest } = require("./cronAuth");

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function handleLiveMatchPushCron(req, res, { env = process.env, run } = {}) {
  const auth = verifyCronRequest(req, env);
  if (!auth.ok) return send(res, auth.status, { ok: false, error: { code: auth.code } });
  try {
    const runner = run || require("../services/liveMatchPush").runLiveMatchPush;
    const result = await runner({ env });
    return send(res, 200, { ok: true, job: "live-match-push", result });
  } catch (error) {
    return send(res, 500, { ok: false, job: "live-match-push", error: { code: "LIVE_MATCH_PUSH_FAILED", message: String(error && error.message || error).slice(0, 160) } });
  }
}

module.exports = { handleLiveMatchPushCron };
