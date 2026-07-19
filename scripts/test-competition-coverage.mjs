import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { competitions, findCompetition, providerLeagueValue } = require("../services/competitionCatalog.js");
const { filterSupportedCompetitions, normalizeFixture } = require("../services/providers/apiFootballProvider.js");
const matchesHandler = require("../api/matches.js");

function fakeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
    end(payload) { this.payload = JSON.parse(payload); return this.payload; }
  };
}

assert.equal(competitions.length, 8, "Altı yerel lig ve iki UEFA turnuvası katalogda olmalı.");
assert.equal(findCompetition("Champions League")?.id, "sampiyonlar-ligi");
assert.equal(findCompetition("UEFA Europa League")?.id, "avrupa-ligi");
assert.equal(providerLeagueValue("premier-league", "api-football"), 39);
assert.equal(providerLeagueValue("avrupa-ligi", "football-data"), null);

const fixture = (id, league, status = "NS") => normalizeFixture({
  fixture: { id, date: "2026-07-19T18:00:00+00:00", status: { short: status } },
  league: { name: league },
  teams: { home: { name: `Ev ${id}` }, away: { name: `Dep ${id}` } },
  goals: { home: null, away: null }
});

const filtered = filterSupportedCompetitions([
  fixture(1, "Premier League"),
  fixture(2, "UEFA Champions League", "1H"),
  fixture(3, "Regional Test League")
]);

assert.deepEqual(filtered.map((match) => match.id), ["1", "2"]);
assert.equal(filtered[0].status, "SCHEDULED");
assert.equal(filtered[0].live, false);
assert.equal(filtered[1].status, "LIVE");
assert.equal(filtered[1].live, true);

const envNames = ["FOOTBALL_MATCH_PROVIDER", "FOOTBALL_PRIMARY_PROVIDER", "FOOTBALL_API_KEY", "APIFOOTBALL_API_KEY"];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
try {
  process.env.FOOTBALL_MATCH_PROVIDER = "football-data";
  process.env.FOOTBALL_PRIMARY_PROVIDER = "football-data";
  process.env.FOOTBALL_API_KEY = "test-only-key";
  delete process.env.APIFOOTBALL_API_KEY;
  const response = fakeResponse();
  await matchesHandler({
    method: "GET",
    url: "/api/matches?league=avrupa-ligi",
    headers: { "x-forwarded-for": "203.0.113.99" }
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.error.code, "COMPETITION_NOT_SUPPORTED");
} finally {
  for (const name of envNames) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
}

console.log("Competition coverage tests passed: 8 competitions, live status and provider fallback checked.");
