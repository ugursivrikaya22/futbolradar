/**
 * GÜNLÜK SAĞLIK KONTROLÜ UÇ NOKTASI — `/api/daily-health-check`.
 *
 * DOSYA `api/` ALTINDA DEĞİL, ÇÜNKÜ ORASI SAYILIYOR — bkz. server/
 * liveLatencyRoute.js başlığındaki aynı gerekçe (Vercel Hobby'nin 12 işlev
 * sınırı). Yönlendirme `api/[...route].js` üzerinden.
 *
 *   GET /api/daily-health-check   → sayfa erişilebilirliği, bayat maç kartı
 *                                    ve bayat ticker öğesi SAYIMI (silmez),
 *                                    canlı skor gecikme özeti.
 *
 * SIR İÇİN GEREKÇE. Bu uç nokta halka açık bir "her şey yolunda mı" paneli
 * DEĞİL — `api/health.js` o rolü zaten üstleniyor ve kasıtlı olarak sırsız.
 * Bu uç nokta GitHub Actions'ın günlük 05:00 TSİ koşusu tarafından
 * ÇAĞRILMAK için var; her isteğinde sağlayıcıya/DB'ye gidip Supabase
 * sorgusu çalıştırıyor (bkz. services/liveEventLatency.js) — halka açık
 * bırakmak bunu ücretsiz bir taciz hedefi yapardı. `DAILY_HEALTH_CHECK_SECRET`
 * eşleşmezse istek daha veri katmanına dokunmadan reddedilir.
 */
const crypto = require("crypto");
const { buildDailyHealthReport } = require("../services/dailyHealthCheckService");
const {
  enforceRateLimit,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("../api/_utils");

const SOURCE = "daily-health-check";
const DEFAULT_SITE_URL = "https://www.futbolradar.com";

/**
 * Header'dan sunulan sırrı okur. `Authorization: Bearer <secret>` VE
 * `x-health-check-secret: <secret>` ikisi de kabul edilir — birincisi HTTP
 * standardı, ikincisi `curl -H` ile elle çağırmayı kolaylaştırıyor.
 */
function suppliedSecret(req) {
  const headers = req.headers || {};
  const authHeader = String(headers.authorization || "");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1].trim();

  const direct = headers["x-health-check-secret"];
  return String(Array.isArray(direct) ? direct[0] : (direct || "")).trim();
}

/** Sabit-zamanlı karşılaştırma — uzunluk farkı bile zamanlama ipucu vermesin diye eşit uzunluğa tamponlanır. */
function secretsMatch(expected, provided) {
  if (!expected || !provided) return false;
  // Sabit uzunluklu özet (SHA-256) üzerinden karşılaştırılır: girdi uzunluğu
  // ne olursa olsun timingSafeEqual her zaman eşit boy tamponlar görür, bu
  // yüzden uzunluk uyuşmazlığı için ayrı bir (ve sağlanan değeri hiç
  // karşılaştırmaya katmayan) dal gerekmez.
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  const providedHash = crypto.createHash("sha256").update(provided).digest();
  return crypto.timingSafeEqual(expectedHash, providedHash);
}

async function handleDailyHealthCheck(req, res) {
  if (rejectUnsupportedMethod(req, res)) return;

  setCachePolicy(res, "daily-health-check");
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: 30 })) return;

  const expected = String(process.env.DAILY_HEALTH_CHECK_SECRET || "").trim();
  if (!expected) {
    return sendError(res, 503, "DAILY_HEALTH_CHECK_SECRET yapilandirilmamis.", "HEALTH_CHECK_NOT_CONFIGURED", SOURCE);
  }

  if (!secretsMatch(expected, suppliedSecret(req))) {
    return sendError(res, 401, "Gecersiz ya da eksik sir.", "UNAUTHORIZED", SOURCE);
  }

  const siteUrl = String(process.env.SITE_URL || DEFAULT_SITE_URL).trim();

  try {
    const report = await buildDailyHealthReport({ siteUrl });
    return sendSuccess(res, report, SOURCE);
  } catch (error) {
    return sendError(res, 200, "Saglik kontrolu raporu uretilemedi.", "HEALTH_CHECK_ERROR", SOURCE);
  }
}

module.exports = { handleDailyHealthCheck };
