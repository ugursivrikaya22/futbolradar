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

assert.equal(competitions.length, 10, "Altı yerel lig, üç UEFA turnuvası ve hazırlık maçları katalogda olmalı.");
assert.equal(findCompetition("Champions League")?.id, "sampiyonlar-ligi");
assert.equal(findCompetition("UEFA Europa League")?.id, "avrupa-ligi");
assert.equal(findCompetition("UEFA Conference League")?.id, "konferans-ligi");
assert.equal(findCompetition("Club Friendly Games")?.id, "hazirlik-maclari");
assert.equal(findCompetition("hazirlik-maci")?.id, "hazirlik-maclari");
assert.equal(providerLeagueValue("premier-league", "api-football"), 39);
assert.equal(providerLeagueValue("avrupa-ligi", "football-data"), null);

const fixture = (id, leagueId, league, status = "NS", country = "") => normalizeFixture({
  fixture: { id, date: "2026-07-19T18:00:00+00:00", status: { short: status } },
  league: { id: leagueId, name: league, country },
  teams: { home: { name: `Ev ${id}` }, away: { name: `Dep ${id}` } },
  goals: { home: null, away: null }
});

const filtered = filterSupportedCompetitions([
  fixture(1, 39, "Premier League", "NS", "England"),
  fixture(2, 2, "UEFA Champions League", "1H", "World"),
  fixture(3, 9001, "Regional Test League"),
  fixture(4, 848, "UEFA Conference League"),
  fixture(5, 667, "Club Friendly Games"),
  fixture(6, 71, "Serie A", "FT", "Brazil"),
  fixture(7, 355, "Premier League", "FT", "Bhutan"),
  fixture(8, 3, "UEFA Europa League", "FT", "World"),
  fixture(9, 135, "Serie A", "FT", "Italy")
]);

assert.deepEqual(filtered.map((match) => match.id), ["1", "2", "4", "5", "8", "9"]);
assert.equal(filtered[0].status, "SCHEDULED");
assert.equal(filtered[0].live, false);
assert.equal(filtered[1].status, "LIVE");
assert.equal(filtered[1].live, true);
assert.equal(filtered.some((match) => match.id === "6"), false, "Brazil Serie A must not be treated as Italian Serie A.");
assert.equal(filtered.some((match) => match.id === "7"), false, "Unrelated Premier League competitions must be excluded.");

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
  assert.equal(response.payload.ok, true);
  assert.ok(Array.isArray(response.payload.data));
} finally {
  for (const name of envNames) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
}

console.log("Competition coverage tests passed: 10 competitions, live status and provider fallback checked.");
