/**
 * VERCEL CRON UÇ NOKTALARI — `/api/cron/<iş>`.
 *
 * DOSYA `api/` ALTINDA DEĞİL: Hobby planının 12 işlev sınırı dolu; yönlendirme
 * `api/[...route].js` (maxDuration 300) üzerinden yapılır.
 *
 *   /api/cron/scheduled-update[?phase=resume]  saatlik veri çekme (parçalı)
 *   /api/cron/full-update[?phase=resume]       günlük tam güncelleme (parçalı)
 *   /api/cron/deploy                           Deploy Hook (saatte en fazla 1)
 *   /api/cron/health                           günlük sağlık raporu
 *   /api/cron/search-demand                    arama talebi verisi
 *
 * HER İSTEK ÖNCE `CRON_SECRET` İLE DOĞRULANIR (server/cronAuth.js). Ortam
 * değişkeni yoksa ya da başlık eşleşmezse 401 döner ve hiçbir iş yapılmaz.
 */
const { verifyCronRequest } = require("./cronAuth");

const SOURCE = "vercel-cron";
const JOBS = new Set(["scheduled-update", "full-update", "deploy", "health", "search-demand"]);

function send(res, statusCode, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (typeof res.status === "function" && typeof res.json === "function") return res.status(statusCode).json(payload);
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

function parse(req) {
  const url = new URL(req.url || "/", "http://localhost");
  const job = url.pathname.replace(/^\/api\/cron\/?/, "").split("/")[0];
  return { job, phase: url.searchParams.get("phase") === "resume" ? "resume" : "start" };
}

async function defaultRunners() {
  const engine = await import("../scripts/lib/cronJobEngine.mjs");
  return {
    "scheduled-update": ({ phase }) => engine.runChunk({ type: "hourly", phase }),
    "full-update": ({ phase }) => engine.runChunk({ type: "full", phase }),
    deploy: () => engine.runDeploy(),
    "search-demand": () => engine.runSearchDemand(),
    health: async () => {
      const { buildDailyHealthReport } = require("../services/dailyHealthCheckService");
      const siteUrl = String(process.env.SITE_URL || "https://www.futbolradar.com").trim();
      return { status: "complete", report: await buildDailyHealthReport({ siteUrl }) };
    }
  };
}

async function handleCron(req, res, { env = process.env, runners } = {}) {
  const auth = verifyCronRequest(req, env);
  if (!auth.ok) return send(res, 401, { ok: false, source: SOURCE, error: { code: auth.code } });

  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") return send(res, 405, { ok: false, source: SOURCE, error: { code: "METHOD_NOT_ALLOWED" } });

  const { job, phase } = parse(req);
  if (!JOBS.has(job)) return send(res, 404, { ok: false, source: SOURCE, error: { code: "CRON_JOB_NOT_FOUND" } });

  try {
    const table = runners || await defaultRunners();
    const result = await table[job]({ phase });
    console.log(`[cron] ${job} ${phase} → ${JSON.stringify(result).slice(0, 500)}`);
    return send(res, 200, { ok: true, source: SOURCE, job, phase, result });
  } catch (error) {
    console.error(`[cron] ${job} hata: ${error && error.message}`);
    return send(res, 500, { ok: false, source: SOURCE, job, error: { code: "CRON_JOB_FAILED", message: String(error && error.message || error).slice(0, 300) } });
  }
}

module.exports = { handleCron, JOBS };
