import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const utils = require("../api/_utils");
const footballData = require("../services/providers/footballProvider");
const apiFootball = require("../services/providers/apiFootballProvider");
const providers = require("../services/providers");
const competitionCatalog = require("../services/competitionCatalog");
const playersHandler = require("../api/players");

function fakeResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    },
    end(payload) {
      this.payload = JSON.parse(payload);
      return this.payload;
    }
  };
}

function testQuerySanitizing() {
  const tooMany = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`param-${index}`, "x".repeat(300)]));
  const sanitized = utils.sanitizeQuery(tooMany);
  assert.equal(Object.keys(sanitized).length, 24);
  assert.equal(sanitized["param-0"].length, 160);
  assert.equal(utils.sanitizeQuery({ team: ["Galatasaray", "Fenerbahce"] }).team, "Galatasaray");
}

function testCachePolicies() {
  assert.equal(utils.cacheControlFor("matches").cdn, "public, s-maxage=60, stale-while-revalidate=180");
  assert.equal(utils.cacheControlFor("players").cdn, "public, s-maxage=3600, stale-while-revalidate=21600");
  assert.equal(utils.cacheControlFor("health").cdn, "no-store");
}

function testRateLimit() {
  const request = { url: "/api/test-rate-limit", headers: { "x-forwarded-for": "203.0.113.8" } };
  assert.equal(utils.enforceRateLimit(request, fakeResponse(), { limit: 2, windowMs: 60000 }), false);
  assert.equal(utils.enforceRateLimit(request, fakeResponse(), { limit: 2, windowMs: 60000 }), false);
  const blocked = fakeResponse();
  assert.equal(utils.enforceRateLimit(request, blocked, { limit: 2, windowMs: 60000 }), true);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.payload.error.code, "RATE_LIMITED");
  assert.equal(blocked.headers["retry-after"], "60");
}

function testResponseFreshness() {
  const unknown = utils.successResponse([], "test");
  assert.equal(unknown.updatedAt, null);
  assert.ok(!Number.isNaN(Date.parse(unknown.responseAt)));

  const known = utils.successResponse([{ fetchedAt: "2026-07-12T09:00:00Z" }], "test");
  assert.equal(known.updatedAt, "2026-07-12T09:00:00.000Z");

  const failed = utils.errorResponse("Provider failed", "PROVIDER_ERROR");
  assert.equal(failed.updatedAt, null);
  assert.equal(failed.error.code, "PROVIDER_ERROR");
}

function testUnknownProviderValues() {
  const footballDataStanding = footballData.normalizeLiveStanding({ team: { id: 1, name: "Test SK" } });
  assert.equal(footballDataStanding.points, null);
  assert.equal(footballDataStanding.played, null);
  assert.equal(footballDataStanding.goalDifference, null);

  const zeroStanding = footballData.normalizeLiveStanding({
    team: { id: 2, name: "Yeni SK" },
    position: 1,
    playedGames: 0,
    won: 0,
    draw: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0
  });
  assert.equal(zeroStanding.points, 0);
  assert.equal(zeroStanding.goalDifference, 0);

  const apiFootballStanding = apiFootball.normalizeStandingRow({ team: { id: 3, name: "Eksik SK" } }, "Super Lig");
  assert.equal(apiFootballStanding.points, null);
  assert.equal(apiFootballStanding.goalsFor, null);

  const apiFootballPlayer = apiFootball.normalizePlayer({ player: { id: 4, name: "Eksik Oyuncu" } });
  assert.equal(apiFootballPlayer.minutesPlayed, null);
  assert.equal(apiFootballPlayer.goals, null);
  assert.equal(apiFootballPlayer.lastSyncedAt, null);
}

function testCompetitionCatalog() {
  assert.equal(competitionCatalog.competitions.length, 8);
  assert.equal(competitionCatalog.providerLeagueValue("premier-league", "api-football"), 39);
  assert.equal(competitionCatalog.providerLeagueValue("sampiyonlar-ligi", "football-data"), "CL");
  assert.equal(competitionCatalog.providerLeagueValue("avrupa-ligi", "api-football"), 3);
  assert.equal(competitionCatalog.providerLeagueValue("avrupa-ligi", "football-data"), null);
  assert.equal(competitionCatalog.providerLeagueValue("all", "api-football"), "");
  assert.equal(competitionCatalog.matchesCompetition("UEFA Champions League", "sampiyonlar-ligi"), true);
  assert.equal(competitionCatalog.matchesCompetition("English Premier League", "premier-league"), true);
  assert.equal(competitionCatalog.matchesCompetition("Campeonato Brasileiro Série A", "serie-a"), false);

  const liveFixture = apiFootball.normalizeFixture({
    fixture: { id: 10, date: "2026-07-16T20:00:00+03:00", status: { short: "2H" } },
    league: { name: "UEFA Champions League" },
    teams: { home: { name: "Ev" }, away: { name: "Deplasman" } },
    goals: { home: 1, away: 0 }
  });
  assert.equal(liveFixture.status, "LIVE");
  assert.equal(liveFixture.live, true);
  assert.equal(liveFixture.providerStatus, "2H");
}

function testMissingKeyFallback() {
  const envNames = [
    ...utils.API_KEY_ENV_NAMES,
    "APIFOOTBALL_API_KEY",
    "FOOTBALL_PRIMARY_PROVIDER",
    "FOOTBALL_MATCH_PROVIDER"
  ];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

  try {
    envNames.forEach((name) => delete process.env[name]);
    assert.equal(providers.getProvider("matches").name, "mock");
    assert.equal(providers.getProvider("players").name, "mock");
  } finally {
    envNames.forEach((name) => {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    });
  }
}

function testConfiguredProviderPreference() {
  const envNames = [
    ...utils.API_KEY_ENV_NAMES,
    "APIFOOTBALL_API_KEY",
    "FOOTBALL_PRIMARY_PROVIDER",
    "FOOTBALL_MATCH_PROVIDER"
  ];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

  try {
    envNames.forEach((name) => delete process.env[name]);
    process.env.APIFOOTBALL_API_KEY = "test-api-football-key";
    process.env.FOOTBALL_API_KEY = "test-football-data-key";

    assert.equal(providers.getProvider("matches").name, "api-football");
    assert.equal(providers.getProvider("standings").name, "api-football");

    process.env.FOOTBALL_MATCH_PROVIDER = "football-data";
    assert.equal(providers.getProvider("matches").name, "football-data");
  } finally {
    envNames.forEach((name) => {
      if (previous[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[name];
      }
    });
  }
}

async function testPlayerLeagueSlugFallback() {
  const response = fakeResponse();
  await playersHandler({
    method: "GET",
    url: "/api/players?league=super-lig",
    headers: { "x-forwarded-for": "203.0.113.81" }
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.ok(Array.isArray(response.payload.data));
  assert.ok(response.payload.data.length > 0);
  assert.ok(response.payload.data.every((player) => player.league === "Süper Lig"));
}

async function testFootballDataCompetitionFallback() {
  const previousFetch = global.fetch;
  const previousKey = process.env.FOOTBALL_API_KEY;
  const previousBaseUrl = process.env.FOOTBALL_API_BASE_URL;

  try {
    process.env.FOOTBALL_API_KEY = "test-key";
    process.env.FOOTBALL_API_BASE_URL = "https://provider.test/v4";
    global.fetch = async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/competitions/PL/matches")) {
        return { ok: false, status: 403, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          matches: [
            { id: 1, utcDate: "2026-05-24T15:00:00Z", status: "FINISHED", competition: { name: "Premier League" }, homeTeam: { name: "Home" }, awayTeam: { name: "Away" }, score: { fullTime: { home: 2, away: 1 } } },
            { id: 2, utcDate: "2026-05-24T18:00:00Z", status: "FINISHED", competition: { name: "Campeonato Brasileiro Série A" }, homeTeam: { name: "Other" }, awayTeam: { name: "Club" }, score: { fullTime: { home: 0, away: 0 } } }
          ]
        })
      };
    };

    const matches = await footballData.getMatches({ date: "2026-05-24", league: "PL", requestedCompetition: "premier-league" });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].league, "Premier League");
    assert.deepEqual(matches[0].score, { home: 2, away: 1 });
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FOOTBALL_API_KEY;
    else process.env.FOOTBALL_API_KEY = previousKey;
    if (previousBaseUrl === undefined) delete process.env.FOOTBALL_API_BASE_URL;
    else process.env.FOOTBALL_API_BASE_URL = previousBaseUrl;
  }
}

testQuerySanitizing();
testCachePolicies();
testRateLimit();
testResponseFreshness();
testUnknownProviderValues();
testCompetitionCatalog();
testMissingKeyFallback();
testConfiguredProviderPreference();
await testPlayerLeagueSlugFallback();
await testFootballDataCompetitionFallback();

console.log("FutbolRadar API resilience tests passed");
