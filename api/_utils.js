const BROWSER_CACHE_CONTROL = "public, max-age=0";
const CACHE_POLICIES = Object.freeze({
  default: { maxAge: 300, stale: 600 },
  matches: { maxAge: 60, stale: 180 },
  // Canlı sorgu ayrı politika: 60 saniyelik CDN önbelleği + 180 saniyelik
  // stale-while-revalidate, oynanan bir maçta dört dakikaya kadar eski skor
  // servis edebiliyordu. Canlı yanıt kısa ömürlü olmalı.
  "matches-live": { maxAge: 10, stale: 20 },
  "match-detail": { maxAge: 30, stale: 120 },
  standings: { maxAge: 300, stale: 900 },
  teams: { maxAge: 1800, stale: 7200 },
  players: { maxAge: 3600, stale: 21600 },
  squad: { maxAge: 300, stale: 900 },
  transfers: { maxAge: 300, stale: 900 },
  momentum: { maxAge: 300, stale: 900 },
  signals: { maxAge: 120, stale: 600 },
  analyses: { maxAge: 3600, stale: 21600 },
  "match-analysis": { maxAge: 300, stale: 900 },
  health: { noStore: true },
  // Anket sayımı her oyla değişiyor ve yanıt seçmene özel bir alan taşıyor
  // (`alreadyVoted`). Önbelleğe alınırsa okuyucu ya eski sonucu görür ya da
  // BAŞKASININ oy durumunu devralır — ikincisi sessiz ve çok daha kötü.
  "motm-vote": { noStore: true },
  // Haftalık liste kişiye özel alan TAŞIMAZ; kısa CDN önbelleği her ana
  // sayfa görüntülemesinin depoya inmesini engeller. 60 saniyelik gecikme
  // "canlı" iddiasını bozmaz — sayım zaten dakikada bir tazeleniyor.
  "motm-week": { maxAge: 60, stale: 120 },
  // Ana sayfa anketi yanıtı seçmene özel alan taşıyor (`alreadyVoted`,
  // `choice`); oy uç noktasıyla aynı gerekçeyle önbelleğe alınmaz.
  "home-poll": { noStore: true }
});
const QUERY_VALUE_MAX_LENGTH = 160;
const QUERY_PARAM_MAX_COUNT = 24;
const RATE_LIMIT_STORE_MAX_SIZE = 2000;
const rateLimitStore = new Map();
const DEFAULT_SOURCE = "FutbolRadar API";
const DEFAULT_TIMEOUT_MS = 5000;
const API_KEY_ENV_NAMES = [
  "FOOTBALL_API_KEY",
  "FOOTBALL_DATA_API_KEY",
  "FOOTBALLDATA_API_KEY",
  "FOOTBALL_DATA_ORG_API_KEY",
  "FOOTBALL_DATA_AUTH_TOKEN",
  "FOOTBALL_DATA_TOKEN",
  "FOOTBALLDATA_TOKEN",
  "FOOTBALL_API_TOKEN"
];
const BASE_URL_ENV_NAMES = [
  "FOOTBALL_API_BASE_URL",
  "FOOTBALL_DATA_BASE_URL",
  "FOOTBALLDATA_BASE_URL"
];
const COMPETITION_CODE_ENV_NAMES = [
  "FOOTBALL_COMPETITION_CODE",
  "FOOTBALL_DATA_COMPETITION_CODE",
  "FOOTBALLDATA_COMPETITION_CODE",
  "COMPETITION_CODE"
];
// API_FOOTBALL_KEY BİLEREK YOK.
//
// Eski ad artık kabul edilmiyor: tek bir kanonik değişken olsun ki hangi
// sırrın kullanıldığı belirsiz kalmasın ve eski secret güvenle silinebilsin.
// Kaldırılmadan önce hiçbir iş akışı onu geçirmiyordu; tek okuyucu buydu.
const APIFOOTBALL_API_KEY_ENV_NAMES = [
  "APIFOOTBALL_API_KEY",
  "API_FOOTBALL_API_KEY",
  "APIFOOTBALL_KEY",
  "API_SPORTS_API_KEY",
  "APISPORTS_API_KEY"
];
const APIFOOTBALL_LEAGUE_ID_ENV_NAMES = [
  "APIFOOTBALL_LEAGUE_ID",
  "API_FOOTBALL_LEAGUE_ID",
  "APIFOOTBALL_LEAGUEID",
  "API_SPORTS_LEAGUE_ID"
];
const APIFOOTBALL_BASE_URL_ENV_NAMES = [
  "APIFOOTBALL_API_BASE_URL",
  "API_FOOTBALL_API_BASE_URL",
  "APIFOOTBALL_BASE_URL",
  "API_FOOTBALL_BASE_URL"
];
const APIFOOTBALL_SEASON_ENV_NAMES = [
  "APIFOOTBALL_SEASON",
  "API_FOOTBALL_SEASON"
];
const APIFOOTBALL_COUNTRY_ENV_NAMES = [
  "APIFOOTBALL_COUNTRY",
  "API_FOOTBALL_COUNTRY"
];

function cacheControlFor(policyName) {
  const policy = CACHE_POLICIES[policyName] || CACHE_POLICIES.default;
  if (policy.noStore) {
    return { browser: "no-store", cdn: "no-store" };
  }

  return {
    browser: BROWSER_CACHE_CONTROL,
    cdn: `public, s-maxage=${policy.maxAge}, stale-while-revalidate=${policy.stale}`
  };
}

function setCachePolicy(res, policyName) {
  res.__futbolRadarCachePolicy = CACHE_POLICIES[policyName] ? policyName : "default";
}

function setCacheHeaders(res) {
  const headers = cacheControlFor(res.__futbolRadarCachePolicy || "default");
  res.setHeader("Cache-Control", headers.browser);
  res.setHeader("CDN-Cache-Control", headers.cdn);
  res.setHeader("Vercel-CDN-Cache-Control", headers.cdn);
}

function sendJson(res, statusCode, payload) {
  setCacheHeaders(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (typeof res.status === "function" && typeof res.json === "function") {
    return res.status(statusCode).json(payload);
  }

  res.statusCode = statusCode;
  return res.end(JSON.stringify(payload));
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveUpdatedAt(data, updatedAt) {
  const explicit = normalizeTimestamp(updatedAt);
  if (explicit) {
    return explicit;
  }

  const records = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
  const timestampFields = [
    "lastVerifiedAt",
    "verifiedAt",
    "fetchedAt",
    "lastSyncedAt",
    "transferUpdatedAt",
    "lastUpdatedAt",
    "lastUpdated",
    "updatedAt"
  ];
  const timestamps = records.flatMap((record) => timestampFields.map((field) => normalizeTimestamp(record && record[field]))).filter(Boolean);

  if (!timestamps.length) {
    return null;
  }

  return timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function successResponse(data, source, updatedAt, meta) {
  const payload = {
    ok: true,
    source: source || DEFAULT_SOURCE,
    updatedAt: resolveUpdatedAt(data, updatedAt),
    responseAt: new Date().toISOString(),
    data
  };

  // `meta` carries provider-failover diagnostics (which provider answered,
  // which ones were skipped and why). It never contains credentials or
  // stack traces, so it can stay on in production instead of being a
  // debug-only field that has to be redeployed whenever live data breaks.
  if (meta && typeof meta === "object") {
    payload.meta = meta;
  }

  return payload;
}

function errorResponse(message, code, source) {
  return {
    ok: false,
    source: source || DEFAULT_SOURCE,
    updatedAt: null,
    responseAt: new Date().toISOString(),
    error: {
      code: code || "API_ERROR",
      message: message || "Veri alinamadi."
    },
    data: []
  };
}

function sendSuccess(res, data, source, updatedAt, meta) {
  return sendJson(res, 200, successResponse(data, source, updatedAt, meta));
}

function sendError(res, statusCode, message, code, source) {
  return sendJson(res, statusCode, errorResponse(message, code, source));
}

function withTimeout(promise, ms) {
  const timeoutMs = Number(ms) || DEFAULT_TIMEOUT_MS;
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Provider timeout")), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback == null ? null : fallback;
  }
}

function safeDataNormalize(value, fallback) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return value;
  }

  return fallback;
}

function sanitizeQuery(query) {
  return Object.fromEntries(Object.entries(query || {}).slice(0, QUERY_PARAM_MAX_COUNT).map(([key, rawValue]) => {
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    return [String(key).slice(0, 64), String(value == null ? "" : value).slice(0, QUERY_VALUE_MAX_LENGTH)];
  }));
}

function getQuery(req) {
  if (req.query) {
    return sanitizeQuery(req.query);
  }

  const url = new URL(req.url || "/", "http://localhost");
  return sanitizeQuery(Object.fromEntries(url.searchParams.entries()));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .trim()
    .toLowerCase();
}

/**
 * İlk dolu ortam değişkeninin değerini kırpılmış olarak döndürür.
 *
 * Kırpma önemli: panelden kopyalanan API anahtarları sık sık sonda bir
 * boşluk veya satır sonu taşıyor. Ham değer HTTP başlığına konduğunda
 * sağlayıcı bunu geçersiz sayıp "Missing application key" döndürüyor —
 * anahtar doğru olduğu hâlde. Sadece boşluk içeren bir değer de "yok"
 * sayılır, böylece yanlışlıkla boş bırakılmış bir değişken sıradaki
 * geçerli ismi gölgelemez.
 */
function firstPresentEnv(names) {
  const found = names.find((name) => String(process.env[name] || "").trim() !== "");
  return found ? String(process.env[found]).trim() : "";
}

function hasProviderConfig() {
  return Boolean(firstPresentEnv(API_KEY_ENV_NAMES));
}

const READ_ONLY_METHODS = new Set(["GET", "HEAD"]);

function rejectUnsupportedMethod(req, res) {
  // HEAD, GET'in gövdesiz hâlidir; uptime kontrolleri ve bazı tarayıcı/CDN
  // ön isteklerinde kullanılır. Eskiden 405 dönüyordu, bu da izleme
  // araçlarında sahte "endpoint kapalı" alarmı üretiyordu. Node HEAD
  // yanıtında gövdeyi kendisi atar; başlıklar ve durum kodu GET ile aynı.
  if (req.method && !READ_ONLY_METHODS.has(req.method)) {
    sendError(res, 405, "Sadece GET ve HEAD istekleri desteklenir.", "METHOD_NOT_ALLOWED");
    return true;
  }

  return false;
}

function validateDateParam(date) {
  if (!date) {
    return null;
  }

  // "all" tarih filtresini kapatan özel değerdir: takım radarındaki fikstür
  // kartı tek bir güne değil, takımın tüm doğrulanmış maçlarına bakar.
  if (String(date).toLowerCase() === "all") {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return "date parametresi YYYY-MM-DD formatinda olmali.";
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return "date parametresi gecerli bir takvim tarihi olmali.";
  }

  return null;
}

function requireAny(item, fields) {
  return fields.some((field) => item[field] !== undefined && item[field] !== null && item[field] !== "");
}

function validateArrayData(data, code) {
  if (!Array.isArray(data)) {
    return { ok: false, code: code || "INVALID_DATA_FORMAT", message: "Veri array formatinda olmali." };
  }

  return { ok: true };
}

function validateCollection(data, validator, code) {
  const arrayResult = validateArrayData(data, code);
  if (!arrayResult.ok) {
    return arrayResult;
  }

  const invalidIndex = data.findIndex((item) => !validator(item || {}));
  if (invalidIndex !== -1) {
    return { ok: false, code, message: `Veri semasi gecersiz. Hatali kayit index: ${invalidIndex}.` };
  }

  return { ok: true };
}

function validateMatches(data) {
  return validateCollection(
    data,
    (item) => item.homeTeam && item.awayTeam && item.league && (item.kickoff || item.time),
    "INVALID_MATCH_SCHEMA"
  );
}

/**
 * Takım kaydı için kimlik zorunlu, ANALİZ alanları değil.
 *
 * Kural eskiden her takımda momentum veya rating arıyordu. Süper Lig kapsamı
 * TFF fikstüründen türetilince, kadro/istatistik verisi olmayan takımlar bu
 * kurala takıldı ve tek bir geçersiz kayıt TÜM takım yanıtını düşürdü —
 * uç nokta 18 takım yerine boş liste döndürüyordu. Momentum uydurmak yerine
 * kural düzeltildi: momentum bir ölçüm, kimlik değil. Ölçümü olmayan takım
 * hâlâ geçerli bir takımdır; arayüz ilgili bölümleri sessizce gizler.
 */
function validateTeams(data) {
  return validateCollection(data, (item) => Boolean(item.name && item.id), "INVALID_TEAM_SCHEMA");
}

function validatePlayers(data) {
  return validateCollection(
    data,
    (item) => item.name && (item.currentTeam || item.team) && requireAny(item, ["position", "rating", "aiRating", "overallRating"]),
    "INVALID_PLAYER_SCHEMA"
  );
}

function validateMomentum(data) {
  return validateCollection(data, (item) => item.team && requireAny(item, ["score", "momentum"]), "INVALID_MOMENTUM_SCHEMA");
}

function validateStandings(data) {
  return validateCollection(data, (item) => item.team && item.points !== undefined, "INVALID_STANDINGS_SCHEMA");
}

function validateSignals(data) {
  return validateCollection(
    data,
    (item) => item.title && requireAny(item, ["type", "severity"]),
    "INVALID_SIGNAL_SCHEMA"
  );
}

function validateAnalyses(data) {
  return validateCollection(data, (item) => item.title && requireAny(item, ["excerpt", "url"]), "INVALID_ANALYSIS_SCHEMA");
}

function validateTransfers(data) {
  return validateCollection(
    data,
    (item) => (item.playerName || item.playerId) && (item.date || item.season) && item.fromTeam && item.toTeam,
    "INVALID_TRANSFER_SCHEMA"
  );
}

function validateSquad(data) {
  return validateCollection(
    data,
    (item) => item.name && (item.currentTeam || item.team) && item.position,
    "INVALID_SQUAD_SCHEMA"
  );
}

function validateMatchDetail(data) {
  return validateCollection(
    data,
    (item) => item.id && item.homeTeam && item.awayTeam && item.league && item.score && Array.isArray(item.events) && Array.isArray(item.statistics),
    "INVALID_MATCH_DETAIL_SCHEMA"
  );
}

function validateOrSend(res, data, validator) {
  const result = validator(data);
  if (!result.ok) {
    sendError(res, 200, result.message, result.code);
    return false;
  }

  return true;
}

function getClientIp(req) {
  return String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "local")
    .split(",")[0]
    .trim();
}

function rateLimitHint(req) {
  // Placeholder for future per-IP rate limiting. Vercel KV/Edge Config or an
  // external store can use this stable key without changing endpoint code.
  return {
    key: `api:${getClientIp(req)}`,
    enabled: false
  };
}

function enforceRateLimit(req, res, options) {
  const now = Date.now();
  const windowMs = Math.max(1000, Number(options && options.windowMs) || 60000);
  const limit = Math.max(1, Math.min(1000, Number(options && options.limit) || 120));
  const pathname = new URL(req.url || "/api", "http://localhost").pathname;
  const key = `${pathname}:${getClientIp(req)}`;
  const current = rateLimitStore.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  rateLimitStore.set(key, entry);

  if (rateLimitStore.size > RATE_LIMIT_STORE_MAX_SIZE) {
    for (const [storedKey, stored] of rateLimitStore) {
      if (stored.resetAt <= now || rateLimitStore.size > RATE_LIMIT_STORE_MAX_SIZE) {
        rateLimitStore.delete(storedKey);
      }
    }
  }

  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - entry.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > limit) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
    sendError(res, 429, "Cok fazla istek gonderildi. Kisa bir sure sonra tekrar dene.", "RATE_LIMITED");
    return true;
  }

  return false;
}

module.exports = {
  DEFAULT_SOURCE,
  DEFAULT_TIMEOUT_MS,
  API_KEY_ENV_NAMES,
  APIFOOTBALL_API_KEY_ENV_NAMES,
  APIFOOTBALL_LEAGUE_ID_ENV_NAMES,
  APIFOOTBALL_BASE_URL_ENV_NAMES,
  APIFOOTBALL_SEASON_ENV_NAMES,
  APIFOOTBALL_COUNTRY_ENV_NAMES,
  BASE_URL_ENV_NAMES,
  COMPETITION_CODE_ENV_NAMES,
  CACHE_POLICIES,
  cacheControlFor,
  enforceRateLimit,
  errorResponse,
  firstPresentEnv,
  getClientIp,
  getQuery,
  hasProviderConfig,
  normalizeText,
  rateLimitHint,
  rejectUnsupportedMethod,
  resolveUpdatedAt,
  safeDataNormalize,
  safeJsonParse,
  sanitizeQuery,
  sendError,
  sendJson,
  sendSuccess,
  setCachePolicy,
  setCacheHeaders,
  successResponse,
  validateAnalyses,
  validateArrayData,
  validateDateParam,
  validateMatches,
  validateMomentum,
  validateMatchDetail,
  validateOrSend,
  validatePlayers,
  validateSquad,
  validateSignals,
  validateStandings,
  validateTeams,
  validateTransfers,
  withTimeout
};
