const { withRetry } = require("../api/_utils");
const { assertMatchDataProvider } = require("./providers/matchDataProvider");
const { dateInTimeZone, dedupeMatches, normalizeMatchRecord } = require("./matchDataService");

function validMatch(match) {
  return Boolean(match.homeTeam && match.awayTeam && match.competitionId && match.kickoffAtUtc);
}

async function synchronizeMatchDate({ provider, date, existing, now }) {
  const adapter = assertMatchDataProvider(provider);
  const fetchedAt = now ? new Date(now).toISOString() : new Date().toISOString();
  const response = await withRetry(() => adapter.fetchMatchesByDate({ date }), {
    attempts: 3,
    baseDelayMs: 200,
    shouldRetry(error) {
      return !error || !["PROVIDER_AUTH_ERROR", "PROVIDER_PLAN_ERROR", "PROVIDER_QUERY_MISSING"].includes(error.code);
    }
  });

  if (!Array.isArray(response)) {
    const error = new TypeError("Provider maç yanıtı dizi olmalı.");
    error.code = "INVALID_PROVIDER_PAYLOAD";
    throw error;
  }

  const normalized = response.map((record) => normalizeMatchRecord(record, {
    fetchedAt,
    lastVerifiedAt: fetchedAt,
    source: adapter.name,
    dataStatus: "provider"
  }));
  const valid = normalized.filter(validMatch);
  const invalid = normalized.filter((match) => !validMatch(match));
  const incoming = dedupeMatches(valid);
  const prior = dedupeMatches(existing || []);
  // A successful provider response is the complete snapshot for that date.
  // Remove the previous date slice so cancelled or withdrawn fixtures do not linger.
  const retained = prior.filter((match) => dateInTimeZone(match.kickoffAtUtc) !== date);
  const records = dedupeMatches([...retained, ...incoming]);

  return {
    records,
    report: {
      ok: true,
      date,
      fetchedAt,
      provider: adapter.name,
      received: response.length,
      accepted: incoming.length,
      invalid: invalid.length,
      duplicates: Math.max(0, valid.length - incoming.length),
      totalStored: records.length,
      dateStored: records.filter((match) => dateInTimeZone(match.kickoffAtUtc) === date).length
    }
  };
}

module.exports = { synchronizeMatchDate, validMatch };
