/**
 * GETİRİCİ — ağ katmanı ve YALNIZCA ağ katmanı.
 *
 * Ayrıştırma, doğrulama ve yayın kararları buranın işi değil. Buranın işi:
 * belgeyi getirmek, getiremezse NEDEN getiremediğini söylemek.
 *
 * Sessiz başarısızlık YASAK. Bir kaynak çöktüğünde hat "bugün transfer yok"
 * demez; "şu kaynak şu sebeple okunamadı" der ve bu satır sağlık raporuna
 * ve bildirime düşer. Aksi hâlde sistem bozukken çalışıyor görünür.
 *
 * YENİDEN DENEME: üstel geri çekilme (1s, 2s, 4s). Yalnızca geçici sayılan
 * hatalar denenir — 404 ya da 403 tekrar denemekle düzelmez, sadece karşı
 * tarafı yorar ve koşuyu geciktirir.
 */

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_ATTEMPTS = 3;
const USER_AGENT = "FutbolRadarBot/1.0 (+https://www.futbolradar.com)";

/** Tekrar denemeye değer HTTP durumları: geçici sunucu/oran sorunları. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Geri çekilme: 1s, 2s, 4s ... */
function backoffMs(attempt) {
  return 1000 * Math.pow(2, attempt);
}

function isRetryableError(error) {
  const name = String((error && error.name) || "");
  const code = String((error && error.code) || "");
  // Zaman aşımı ve ağ seviyesi kopmalar geçicidir.
  return (
    name === "AbortError" ||
    name === "TypeError" ||
    ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(code)
  );
}

/**
 * Cloudflare tarayıcı doğrulama sayfası mı?
 *
 * 200 dönen ama içeriği "bir dakika bekleyin" olan bir yanıt, ayrıştırıcıya
 * gitmemeli: gövdede transfer yok, üstelik 200 olduğu için hata da sayılmaz.
 * Bu sessiz başarısızlığın tam örneği; burada yakalanır.
 */
function looksLikeChallenge(body) {
  const head = String(body || "").slice(0, 1500).toLowerCase();
  return (
    head.includes("just a moment") ||
    head.includes("cf-browser-verification") ||
    head.includes("challenge-platform") ||
    head.includes("enable javascript and cookies to continue")
  );
}

/**
 * Tek bir kaynağı getirir.
 *
 * @returns {Promise<{ok: boolean, status: number, body: string, url: string,
 *   attempts: number, durationMs: number, error: string, fetchedAt: string}>}
 *   `ok` false ise `error` DOLU olur. Çağıran hatayı yutmamalı.
 */
async function fetchSource(source, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const attempts = Number.isFinite(options.attempts) ? options.attempts : DEFAULT_ATTEMPTS;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const waitFn = options.sleepImpl || sleep;
  const startedAt = Date.now();
  const url = String((source && source.url) || "");

  if (!fetchImpl) {
    return {
      ok: false, status: 0, body: "", url, attempts: 0,
      durationMs: 0, error: "fetch uygulaması yok", fetchedAt: new Date().toISOString()
    };
  }

  if (!url) {
    return {
      ok: false, status: 0, body: "", url, attempts: 0,
      durationMs: 0, error: "kaynak url yok", fetchedAt: new Date().toISOString()
    };
  }

  let lastError = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await waitFn(backoffMs(attempt - 1));

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
          "accept-language": "tr-TR,tr;q=0.9"
        },
        redirect: "follow",
        signal: controller ? controller.signal : undefined
      });

      lastStatus = Number(response.status) || 0;

      if (!response.ok) {
        lastError = `HTTP ${lastStatus}`;
        if (RETRYABLE_STATUS.has(lastStatus)) continue;
        break;
      }

      const body = await response.text();

      if (looksLikeChallenge(body)) {
        // Tekrar denemek işe yaramaz: engel tarayıcı doğrulaması, geçici
        // bir sunucu sorunu değil.
        lastError = "tarayıcı doğrulaması (Cloudflare) — sunucu tarafı istek geçemiyor";
        break;
      }

      return {
        ok: true,
        status: lastStatus,
        body,
        url,
        attempts: attempt + 1,
        durationMs: Date.now() - startedAt,
        error: "",
        fetchedAt: new Date().toISOString()
      };
    } catch (error) {
      lastError = String((error && error.message) || error);
      if (!isRetryableError(error)) break;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    body: "",
    url,
    attempts,
    durationMs: Date.now() - startedAt,
    error: lastError || "bilinmeyen hata",
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Birden çok kaynağı getirir. Biri çökerse diğerleri devam eder — tek bir
 * gazetenin RSS'i düştü diye koşu iptal olmaz.
 */
async function fetchAll(sources, options = {}) {
  const results = [];
  for (const source of sources) {
    const result = await fetchSource(source, options);
    results.push({ source, result });
  }
  return results;
}

module.exports = {
  DEFAULT_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  RETRYABLE_STATUS,
  USER_AGENT,
  backoffMs,
  fetchAll,
  fetchSource,
  isRetryableError,
  looksLikeChallenge
};
