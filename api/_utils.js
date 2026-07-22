const BROWSER_CACHE_CONTROL = "public, max-age=0";
const CACHE_POLICIES = Object.freeze({
  default: { maxAge: 300, stale: 600 },
  matches: { maxAge: 60, stale: 180 },
  "match-detail": { maxAge: 30, stale: 120 },
  standings: { maxAge: 300, stale: 900 },
  teams: { maxAge: 1800, stale: 7200 },
  players: { maxAge: 3600, stale: 21600 },
  squad: { maxAge: 300, stale: 900 },
  transfers: { maxAge: 300, stale: 900 },
  momentum: { maxAge: 300, stale: 900 },
  signals: { maxAge: 120, stale: 600 },
  analyses: { maxAge: 3600, stale: 21600 },
  health: { noStore: true }
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

function successResponse(data, source, updatedAt) {
  return {
    ok: true,
    source: source || DEFAULT_SOURCE,
    updatedAt: resolveUpdatedAt(data, updatedAt),
    responseAt: new Date().toISOString(),
    data
  };
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

function sendSuccess(res, data, source, updatedAt) {
  return sendJson(res, 200, successResponse(data, source, updatedAt));
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(operation, options) {
  const settings = options && typeof options === "object" ? options : {};
  const attempts = Math.max(1, Math.min(5, Number(settings.attempts) || 3));
  const baseDelayMs = Math.max(25, Number(settings.baseDelayMs) || 150);
  const shouldRetry = typeof settings.shouldRetry === "function" ? settings.shouldRetry : () => true;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error, attempt)) throw error;
      await wait(baseDelayMs * (2 ** (attempt - 1)));
    }
  }

  throw lastError;
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

function firstPresentEnv(names) {
  const found = names.find((name) => Boolean(process.env[name]));
  return found ? process.env[found] : "";
}

function hasProviderConfig() {
  return Boolean(firstPresentEnv(API_KEY_ENV_NAMES));
}

function rejectUnsupportedMethod(req, res) {
  if (req.method && req.method !== "GET") {
    sendError(res, 405, "Sadece GET istekleri desteklenir.", "METHOD_NOT_ALLOWED");
    return true;
  }

  return false;
}

function validateDateParam(date) {
  if (!date) {
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

function validateTeams(data) {
  return validateCollection(data, (item) => item.name && requireAny(item, ["momentum", "rating"]), "INVALID_TEAM_SCHEMA");
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
  BASE_URL_ENV_NAMES,
  COMPETITION_CODE_ENV_NAMES,
  CACHE_POLICIES,
  cacheControlFor,
  enforceRateLimit,
  errorResponse,
  firstPresentEnv,
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
  withRetry,
  withTimeout
};
