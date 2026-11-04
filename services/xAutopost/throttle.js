/**
 * X API YAZMA KOTASI — kuyruk + token-bucket kısıcı (saf; ağ yok).
 *
 * Resmî sınırlar (POST /2/tweets, docs.x.com/x-api/fundamentals/rate-limits,
 * 4 Kasım 2026'da doğrulandı): kullanıcı başına 100 istek / 15 dk,
 * uygulama başına 10.000 istek / 24 sa. Güvenlik payıyla varsayılan tavanlar
 * %80'dir (80 / 15 dk, 8.000 / 24 sa). Her istek (ana gönderi VE bağlantı
 * yanıtı) ayrı sayılır.
 *
 * Sunucusuz cron her koşuda sıfırdan başladığı için pencere sayımları
 * kalıcı depodan (`x_autopost_posts.created_at`) gelir: `seed15m`, `seed24h`.
 */
const USER_LIMIT_15M = 100;
const APP_LIMIT_24H = 10000;
const WINDOW_15M = 15 * 60e3;
const WINDOW_24H = 24 * 3600e3;

function createThrottle({ limit15m = USER_LIMIT_15M, limit24h = APP_LIMIT_24H, safety = 0.8, seed15m = 0, seed24h = 0, minGapMs = 0, now = () => Date.now() } = {}) {
  const cap15 = Math.max(1, Math.floor(limit15m * safety));
  const cap24 = Math.max(1, Math.floor(limit24h * safety));
  const sent = []; // bu koşuda gönderilen isteklerin zamanları
  let blockedUntil = 0;
  const inWindow = (ms) => sent.filter((t) => now() - t < ms).length;
  return {
    cap15, cap24,
    /** İstek şimdi gönderilebilir mi? { ok, reason, waitMs } */
    check() {
      const t = now();
      if (blockedUntil > t) return { ok: false, reason: "rate-limited", waitMs: blockedUntil - t };
      if (seed15m + inWindow(WINDOW_15M) >= cap15) return { ok: false, reason: "user-15m-cap", waitMs: WINDOW_15M };
      if (seed24h + inWindow(WINDOW_24H) >= cap24) return { ok: false, reason: "app-24h-cap", waitMs: WINDOW_24H };
      const last = sent[sent.length - 1];
      if (minGapMs && last && t - last < minGapMs) return { ok: false, reason: "min-gap", waitMs: minGapMs - (t - last) };
      return { ok: true, reason: null, waitMs: 0 };
    },
    record() { sent.push(now()); },
    /** 429 sonrası: sonraki koşuya kadar yeni istek yok. */
    block(untilMs) { blockedUntil = Math.max(blockedUntil, untilMs); },
    get blockedUntil() { return blockedUntil; },
    get sentThisRun() { return sent.length; }
  };
}

/**
 * 429 yanıtından bekleme süresi (ms). Önce `retry-after` (saniye ya da HTTP
 * tarihi), sonra `x-rate-limit-reset` (Unix saniyesi; X dokümanı), yoksa
 * üstel geri çekilme: 60 sn · 2^deneme (en çok 15 dk).
 */
function rateLimitWaitMs(headers, { now = Date.now(), attempt = 0 } = {}) {
  const get = (k) => (headers && typeof headers.get === "function" ? headers.get(k) : headers && (headers[k] ?? headers[k.toLowerCase()]));
  const ra = get("retry-after");
  if (ra != null && ra !== "") {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
    const at = Date.parse(ra);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  const reset = Number(get("x-rate-limit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(1000, reset * 1000 - now);
  return Math.min(WINDOW_15M, 60e3 * 2 ** Math.max(0, attempt));
}

module.exports = { createThrottle, rateLimitWaitMs, USER_LIMIT_15M, APP_LIMIT_24H, WINDOW_15M, WINDOW_24H };
