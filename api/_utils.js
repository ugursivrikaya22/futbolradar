const BROWSER_CACHE_CONTROL = "public, max-age=0";
const CDN_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";
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

function setCacheHeaders(res) {
  res.setHeader("Cache-Control", BROWSER_CACHE_CONTROL);
  res.setHeader("CDN-Cache-Control", CDN_CACHE_CONTROL);
  res.setHeader("Vercel-CDN-Cache-Control", CDN_CACHE_CONTROL);
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

function successResponse(data, source, updatedAt) {
  return {
    ok: true,
    source: source || DEFAULT_SOURCE,
    updatedAt: updatedAt || new Date().toISOString(),
    data
  };
}

function errorResponse(message, code, source) {
  return {
    ok: false,
    source: source || DEFAULT_SOURCE,
    updatedAt: new Date().toISOString(),
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

function getQuery(req) {
  if (req.query) {
    return req.query;
  }

  const url = new URL(req.url || "/", "http://localhost");
  return Object.fromEntries(url.searchParams.entries());
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

module.exports = {
  DEFAULT_SOURCE,
  DEFAULT_TIMEOUT_MS,
  API_KEY_ENV_NAMES,
  BASE_URL_ENV_NAMES,
  COMPETITION_CODE_ENV_NAMES,
  errorResponse,
  firstPresentEnv,
  getQuery,
  hasProviderConfig,
  normalizeText,
  rateLimitHint,
  rejectUnsupportedMethod,
  safeDataNormalize,
  safeJsonParse,
  sendError,
  sendJson,
  sendSuccess,
  setCacheHeaders,
  successResponse,
  validateAnalyses,
  validateArrayData,
  validateDateParam,
  validateMatches,
  validateMomentum,
  validateOrSend,
  validatePlayers,
  validateSignals,
  validateStandings,
  validateTeams,
  validateTransfers,
  withTimeout
};
