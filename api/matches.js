const { getProvider } = require("../services/providers");
const { providerLeagueValue } = require("../services/competitionCatalog");
const manualFallbackMatches = require("../data/manual-fallback-matches.json");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateDateParam,
  validateMatches,
  validateOrSend,
  withTimeout
} = require("./_utils");

const DEFAULT_TIMEZONE = "Europe/Istanbul";
const MANUAL_FALLBACK_SOURCE = "FutbolRadar Manual Verified";

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch (error) {
    return false;
  }
}

function resolveTimezone(value) {
  return value && isValidTimeZone(value) ? value : DEFAULT_TIMEZONE;
}

function todayInTimeZone(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function parseBooleanParam(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "evet"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "hayir", "hayır"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function matchKey(match) {
  return String(
    (match && match.id) ||
    [match && match.homeTeam, match && match.awayTeam, match && (match.kickoff || match.time)].join("|")
  ).toLocaleLowerCase("tr-TR");
}

function dedupeMatches(matches) {
  const seen = new Set();
  return (Array.isArray(matches) ? matches : []).filter((match) => {
    const key = matchKey(match);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function manualFallbackForDate(date, includeFriendlies) {
  if (!includeFriendlies) {
    return [];
  }

  const records = manualFallbackMatches[date];
  return Array.isArray(records) ? records : [];
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "matches");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const dateError = validateDateParam(query.date);
  if (dateError) {
    return sendError(res, 200, dateError, "INVALID_DATE");
  }

  const timezone = resolveTimezone(query.timezone);
  const resolvedDate = query.date || todayInTimeZone(timezone);
  const includeFriendlies = parseBooleanParam(query.includeFriendlies, true);

  const provider = getProvider("matches");
  const providerQuery = {
    ...query,
    date: query.date || resolvedDate,
    timezone,
    includeFriendlies,
    requestedCompetition: query.league || "",
    league: providerLeagueValue(query.league, provider.name)
  };
  if (query.league && providerQuery.league === null) {
    return sendError(
      res,
      200,
      "Seçilen turnuva mevcut canlı veri sağlayıcısında desteklenmiyor; yedek veri denenecek.",
      "COMPETITION_NOT_SUPPORTED"
    );
  }

  let data = [];
  let providerError = null;

  try {
    const result = await withTimeout(provider.getMatches(providerQuery), DEFAULT_TIMEOUT_MS);
    data = Array.isArray(result) ? result : [];
  } catch (error) {
    providerError = error;
  }

  // Manual fallback only ever fires for dates that have a curated entry
  // (currently just 2026-07-25) — every other date keeps the provider's
  // real empty/error result instead of silently inventing fixtures.
  let source = provider.source;
  if (!data.length) {
    const fallback = manualFallbackForDate(resolvedDate, includeFriendlies);
    if (fallback.length) {
      data = fallback;
      source = MANUAL_FALLBACK_SOURCE;
    } else if (providerError) {
      return sendError(
        res,
        200,
        providerError.message || "Mac verisi provider katmanindan alinamadi.",
        providerError.code || "PROVIDER_ERROR"
      );
    }
  }

  data = dedupeMatches(data);

  if (!validateOrSend(res, data, validateMatches)) {
    return;
  }

  return sendSuccess(res, data, source);
};
