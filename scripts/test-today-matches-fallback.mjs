import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const matchesHandler = require("../api/matches.js");
const apiFootball = require("../services/providers/apiFootballProvider.js");
const utils = require("../api/_utils.js");

const FALLBACK_DATE = "2026-07-25";

function fakeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
    end(payload) { this.payload = JSON.parse(payload); return this.payload; }
  };
}

function clearProviderEnv() {
  const envNames = [
    ...utils.API_KEY_ENV_NAMES,
    ...utils.APIFOOTBALL_API_KEY_ENV_NAMES,
    "FOOTBALL_PRIMARY_PROVIDER",
    "FOOTBALL_MATCH_PROVIDER"
  ];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  envNames.forEach((name) => delete process.env[name]);
  return () => {
    envNames.forEach((name) => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  };
}

async function testFallbackReturnsThirteenFixtures() {
  const restoreEnv = clearProviderEnv();
  try {
    const response = fakeResponse();
    await matchesHandler({
      method: "GET",
      url: `/api/matches?date=${FALLBACK_DATE}&timezone=Europe/Istanbul&includeFriendlies=true`,
      headers: { "x-forwarded-for": "198.51.100.10" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true, "Fallback response should report ok:true");
    const data = response.payload.data;
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 13, `Expected 13 fixtures for ${FALLBACK_DATE}, got ${data.length}`);

    const ids = data.map((match) => match.id);
    assert.equal(new Set(ids).size, ids.length, "Fallback fixtures must not contain duplicates");

    data.forEach((match) => {
      assert.equal(match.source, "manual-verified");
      assert.equal(match.isFallback, true);
      assert.equal(match.isFriendly, true);
      assert.equal(match.score.home, null, `${match.homeTeam}-${match.awayTeam} should not have a fabricated score`);
      assert.equal(match.score.away, null, `${match.homeTeam}-${match.awayTeam} should not have a fabricated score`);
    });

    function findMatch(home, away) {
      return data.find((match) => match.homeTeam === home && match.awayTeam === away);
    }

    const konyaHull = findMatch("Konyaspor", "Hull City");
    assert.ok(konyaHull, "Konyaspor - Hull City should be present");
    assert.equal(konyaHull.time, "18:30");

    const raalSamsun = findMatch("RAAL La Louvière", "Samsunspor");
    assert.ok(raalSamsun, "RAAL La Louvière - Samsunspor should be present");
    assert.equal(raalSamsun.time, "15:00");

    const rizespor = findMatch("NK Osijek", "Çaykur Rizespor");
    assert.ok(rizespor, "NK Osijek - Çaykur Rizespor should be present");
    assert.equal(rizespor.time, "21:00");

    const standardJuve = findMatch("Standard Liège", "Juventus");
    assert.ok(standardJuve, "Standard Liège - Juventus should be present");
    assert.equal(standardJuve.time, "21:00");
    assert.equal(standardJuve.kickoff, "2026-07-25T21:00:00+03:00");

    const portoVilla = findMatch("FC Porto", "Aston Villa");
    assert.ok(portoVilla, "FC Porto - Aston Villa should be present");
    assert.equal(portoVilla.time, "22:00");
    assert.equal(portoVilla.kickoff, "2026-07-25T22:00:00+03:00");

    const hasLiverpoolSunderland = data.some((match) => {
      return [match.homeTeam, match.awayTeam].some((team) => /liverpool|sunderland/i.test(String(team)));
    });
    assert.equal(hasLiverpoolSunderland, false, "Liverpool - Sunderland must not appear in the 2026-07-25 list");
  } finally {
    restoreEnv();
  }
}

async function testIncludeFriendliesFalseReturnsEmpty() {
  const restoreEnv = clearProviderEnv();
  try {
    const response = fakeResponse();
    await matchesHandler({
      method: "GET",
      url: `/api/matches?date=${FALLBACK_DATE}&includeFriendlies=false`,
      headers: { "x-forwarded-for": "198.51.100.11" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.deepEqual(response.payload.data, []);
  } finally {
    restoreEnv();
  }
}

async function testFallbackScopedToItsOwnDate() {
  const restoreEnv = clearProviderEnv();
  try {
    const response = fakeResponse();
    await matchesHandler({
      method: "GET",
      url: "/api/matches?date=2026-08-01&includeFriendlies=true",
      headers: { "x-forwarded-for": "198.51.100.12" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.deepEqual(response.payload.data, [], "Manual fallback must never leak into dates it has no curated entry for");
  } finally {
    restoreEnv();
  }
}

async function testApiFootballFriendlyPassThrough() {
  const previousFetch = global.fetch;
  const previousKey = process.env.APIFOOTBALL_API_KEY;

  try {
    process.env.APIFOOTBALL_API_KEY = "test-api-football-key";
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        errors: [],
        response: [
          {
            fixture: { id: 501, date: "2026-07-25T14:00:00+03:00", status: { short: "NS" } },
            league: { name: "Friendlies Clubs" },
            teams: { home: { name: "Test Home" }, away: { name: "Test Away" } },
            goals: { home: null, away: null }
          },
          {
            fixture: { id: 502, date: "2026-07-25T16:00:00+03:00", status: { short: "NS" } },
            league: { name: "Premier League" },
            teams: { home: { name: "Official Home" }, away: { name: "Official Away" } },
            goals: { home: null, away: null }
          }
        ]
      })
    });

    const withoutFriendlies = await apiFootball.getMatches({ date: "2026-07-25" });
    assert.equal(withoutFriendlies.length, 1, "Default request should exclude friendlies");
    assert.equal(withoutFriendlies[0].league, "Premier League");

    const withFriendlies = await apiFootball.getMatches({ date: "2026-07-25", includeFriendlies: true });
    assert.equal(withFriendlies.length, 2, "includeFriendlies:true should keep both official and friendly fixtures");
    const friendly = withFriendlies.find((match) => match.homeTeam === "Test Home");
    assert.ok(friendly);
    assert.equal(friendly.competitionId, "hazirlik-maci");
    assert.equal(friendly.league, "Hazırlık Maçı");
    assert.equal(friendly.isFriendly, true);

    const friendlyOnly = await apiFootball.getMatches({
      date: "2026-07-25",
      league: "hazirlik-maci",
      requestedCompetition: "hazirlik-maci"
    });
    assert.equal(friendlyOnly.length, 1);
    assert.equal(friendlyOnly[0].homeTeam, "Test Home");
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.APIFOOTBALL_API_KEY;
    else process.env.APIFOOTBALL_API_KEY = previousKey;
  }
}

await testFallbackReturnsThirteenFixtures();
await testIncludeFriendliesFalseReturnsEmpty();
await testFallbackScopedToItsOwnDate();
await testApiFootballFriendlyPassThrough();

console.log("Today's matches fallback tests passed: 13 fixtures, no duplicates, no Liverpool-Sunderland, friendlies gated correctly.");
