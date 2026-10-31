/**
 * CRON_SECRET DOĞRULAMASI — `/api/cron/*` uç noktalarının tek kapısı.
 *
 * Vercel Cron, proje ortamında `CRON_SECRET` tanımlıysa her çağrıya
 * `Authorization: Bearer <CRON_SECRET>` ekler. Ortam değişkeni yoksa ya da
 * başlık eşleşmezse istek 401 ile reddedilir ve HİÇBİR iş yapılmaz
 * (veri katmanına, sağlayıcıya, Supabase'e dokunulmaz).
 *
 * Karşılaştırma sabit zamanlı: iki taraf da SHA-256 özetine çevrilip
 * `timingSafeEqual` ile kıyaslanır; uzunluk farkı zamanlama ipucu vermez.
 */
const crypto = require("crypto");

function bearerToken(req) {
  const headers = (req && req.headers) || {};
  const raw = headers.authorization || headers.Authorization || "";
  const value = Array.isArray(raw) ? raw[0] : String(raw);
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function constantTimeEqual(expected, provided) {
  if (!expected || !provided) return false;
  const a = crypto.createHash("sha256").update(String(expected)).digest();
  const b = crypto.createHash("sha256").update(String(provided)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** @returns {{ok: true} | {ok: false, status: 401, code: string}} */
function verifyCronRequest(req, env = process.env) {
  const expected = String(env.CRON_SECRET || "").trim();
  if (!expected) return { ok: false, status: 401, code: "CRON_SECRET_NOT_CONFIGURED" };
  if (!constantTimeEqual(expected, bearerToken(req))) return { ok: false, status: 401, code: "UNAUTHORIZED" };
  return { ok: true };
}

module.exports = { bearerToken, constantTimeEqual, verifyCronRequest };
