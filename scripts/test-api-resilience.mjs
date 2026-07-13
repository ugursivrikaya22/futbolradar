import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const utils = require("../api/_utils");
const footballData = require("../services/providers/footballProvider");
const apiFootball = require("../services/providers/apiFootballProvider");
const providers = require("../services/providers");

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

testQuerySanitizing();
testCachePolicies();
testRateLimit();
testResponseFreshness();
testUnknownProviderValues();
testMissingKeyFallback();

console.log("FutbolRadar API resilience tests passed");
