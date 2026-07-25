import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const utils = require("../api/_utils");
const footballData = require("../services/providers/footballProvider");
const apiFootball = require("../services/providers/apiFootballProvider");
const providers = require("../services/providers");
const competitionCatalog = require("../services/competitionCatalog");
const playersHandler = require("../api/players");
const matchesHandler = require("../api/matches");
const mockProvider = require("../services/providers/mockProvider");

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
  assert.equal(competitionCatalog.competitions.length, 10);
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
    assert.equal(providers.getProvider("match-detail").name, "api-football");

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

/**
 * Production teşhisinin bire bir kopyası: API-Football ücretsiz paketi
 * içinde bulunulan sezona erişim vermiyor. Eskiden bu tek hata
 * /api/matches yanıtını `ok:false` + boş listeye çeviriyor, "Bugünkü
 * Maçlar" sayfası da boş kalıyordu. Artık zincir bir sonraki sağlayıcıya
 * geçmeli ve kürasyonlu maçlarla 200/ok:true dönmeli.
 */
async function testPlanErrorFailsOverToCuratedData() {
  const envNames = [...utils.API_KEY_ENV_NAMES, "APIFOOTBALL_API_KEY", "FOOTBALL_PRIMARY_PROVIDER", "FOOTBALL_MATCH_PROVIDER"];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const previousFetch = global.fetch;

  try {
    envNames.forEach((name) => delete process.env[name]);
    process.env.APIFOOTBALL_API_KEY = "test-free-plan-key";
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        get: "fixtures",
        errors: { plan: "Free plans do not have access to this season, try from 2022 to 2024." },
        results: 0,
        response: []
      })
    });

    const response = fakeResponse();
    await matchesHandler({
      method: "GET",
      url: "/api/matches?date=2026-07-23",
      headers: { "x-forwarded-for": "203.0.113.44" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true, "plan hatasi tum yaniti bosaltmamali");
    assert.ok(response.payload.data.length > 0, "kurasyonlu mac listesi devreye girmeli");
    assert.equal(response.payload.meta.degraded, true);
    assert.equal(response.payload.meta.provider, "mock");

    const apiFootballAttempt = response.payload.meta.attempts.find((attempt) => attempt.provider === "api-football");
    assert.equal(apiFootballAttempt.status, "error");
    assert.equal(apiFootballAttempt.code, "PROVIDER_PLAN_ERROR");
    assert.equal(apiFootballAttempt.permanent, true);

    assert.equal(apiFootballAttempt.detail, undefined, "saglayici hata govdesi varsayilan olarak kapali olmali");

    const serialized = JSON.stringify(response.payload);
    assert.ok(!serialized.includes("test-free-plan-key"), "teshis alani kimlik bilgisi sizdirmamali");

    // ?debug=1 ile sağlayıcının kendi hata metni görünür olmalı; operatör
    // sorunun anahtar mı, paket mi, sorgu mu olduğunu buradan ayırt eder.
    const debugResponse = fakeResponse();
    await matchesHandler({
      method: "GET",
      url: "/api/matches?date=2026-07-23&debug=1",
      headers: { "x-forwarded-for": "203.0.113.45" }
    }, debugResponse);
    const debugAttempt = debugResponse.payload.meta.attempts.find((attempt) => attempt.provider === "api-football");
    assert.match(debugAttempt.detail, /Free plans do not have access to this season/);
    assert.ok(!JSON.stringify(debugResponse.payload).includes("test-free-plan-key"));
  } finally {
    global.fetch = previousFetch;
    envNames.forEach((name) => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  }
}

function testProviderChainOrder() {
  const envNames = [...utils.API_KEY_ENV_NAMES, "APIFOOTBALL_API_KEY", "FOOTBALL_PRIMARY_PROVIDER", "FOOTBALL_MATCH_PROVIDER"];
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

  try {
    envNames.forEach((name) => delete process.env[name]);
    process.env.APIFOOTBALL_API_KEY = "test-api-football-key";
    process.env.FOOTBALL_API_KEY = "test-football-data-key";

    assert.deepEqual(
      providers.getProviderChain("matches").map((provider) => provider.name),
      ["api-football", "football-data", "mock"]
    );

    delete process.env.APIFOOTBALL_API_KEY;
    assert.deepEqual(
      providers.getProviderChain("matches").map((provider) => provider.name),
      ["football-data", "mock"]
    );

    delete process.env.FOOTBALL_API_KEY;
    assert.deepEqual(providers.getProviderChain("matches").map((provider) => provider.name), ["mock"]);
  } finally {
    envNames.forEach((name) => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
  }
}

/**
 * Kürasyonlu veri seti bir gün geride kalabiliyor: 23 Temmuz'daki
 * Beşiktaş - Midtjylland maçı dosyada hâlâ "SCHEDULED" duruyordu.
 * Sağlayıcı takvimi maç durumunu ileri taşımalı, ama doğrulanmış bir
 * skoru asla ezmemeli.
 */
async function testCuratedAndCalendarMerge() {
  const finished = await mockProvider.getMatches({ date: "2026-07-23" });
  assert.equal(finished.length, 1);
  assert.equal(finished[0].status, "FINISHED");
  assert.equal(finished[0].score.home, 1);
  assert.equal(finished[0].score.away, 0);
  assert.ok(finished[0].analysisPage || finished[0].summary || finished[0].id, "editoryal alanlar korunmali");

  const today = await mockProvider.getMatches({ date: "2026-07-25" });
  assert.ok(today.length > 0, "fikstur takvimi bugunun maclarini saglamali");
  assert.ok(today.every((match) => match.homeTeam && match.awayTeam && match.league && match.kickoff));
}

function testCuratedLeagueFilterUsesCatalog() {
  // "sampiyonlar-ligi" slug'ı "UEFA Şampiyonlar Ligi" satırıyla birebir
  // eşleşmediği için lig filtresi kürasyonlu veride hiç sonuç dönmüyordu.
  return Promise.all([
    mockProvider.getMatches({ date: "2026-07-21", league: "Şampiyonlar Ligi" }),
    mockProvider.getMatches({ date: "2026-07-24", league: "hazirlik-maci" })
  ]).then(([championsLeague, friendlies]) => {
    assert.equal(championsLeague.length, 1);
    assert.ok(friendlies.length > 0);
  });
}

function testApiFootballErrorClassification() {
  assert.equal(
    apiFootball.classifyPayloadError(["Invalid application key"]).code,
    "PROVIDER_AUTH_ERROR"
  );
  assert.equal(
    apiFootball.classifyPayloadError(["You have reached the request limit"]).code,
    "PROVIDER_RATE_LIMIT"
  );
  assert.equal(
    apiFootball.classifyPayloadError(["Your subscription plan does not allow this endpoint"]).code,
    "PROVIDER_PLAN_ERROR"
  );
  assert.equal(
    apiFootball.classifyPayloadError(["No results for this season"]).code,
    "PROVIDER_DATA_UNAVAILABLE"
  );
  // Production'da dönen gerçek metin. "season" kelimesi yüzünden geçici
  // veri yokluğu sanılıp zincirin durmasına yol açmamalı.
  assert.equal(
    apiFootball.classifyPayloadError(["Free plans do not have access to this season, try from 2022 to 2024."]).code,
    "PROVIDER_PLAN_ERROR"
  );
  assert.equal(
    apiFootball.classifyPayloadError(["You are not subscribed to this API."]).code,
    "PROVIDER_PLAN_ERROR"
  );
}

function testSeasonDerivation() {
  // Avrupa sezonu temmuzda başlar: 2026-07-25 -> "2026", 2027-03-01 -> "2026".
  assert.equal(apiFootball.seasonForDate("2026-07-25"), "2026");
  assert.equal(apiFootball.seasonForDate("2026-12-31"), "2026");
  assert.equal(apiFootball.seasonForDate("2027-03-01"), "2026");
  assert.equal(apiFootball.seasonForDate("2027-08-01"), "2027");
}

function testLiveMatchDetailNormalization() {
  const match = {
    id: "99",
    homeTeam: "Ev SK",
    awayTeam: "Dep SK",
    live: true,
    score: { home: 1, away: 0 }
  };
  const lineups = apiFootball.normalizeFixtureLineups([
    {
      team: { name: "Ev SK" },
      formation: "4-2-3-1",
      startXI: [{ player: { name: "Oyuncu Bir" } }],
      substitutes: [{ player: { name: "Yedek Bir" } }]
    }
  ]);
  const events = apiFootball.normalizeFixtureEvents([
    {
      time: { elapsed: 37 },
      team: { name: "Ev SK" },
      player: { name: "Golcu" },
      assist: { name: "Asistci" },
      type: "Goal",
      detail: "Normal Goal"
    }
  ]);
  const statistics = apiFootball.normalizeFixtureStatistics([
    { team: { name: "Ev SK" }, statistics: [
      { type: "Ball Possession", value: "61%" },
      { type: "Total Shots", value: 12 },
      { type: "Shots on Goal", value: 5 },
      { type: "expected_goals", value: "1.42" }
    ] },
    { team: { name: "Dep SK" }, statistics: [
      { type: "Ball Possession", value: "39%" },
      { type: "Total Shots", value: 5 },
      { type: "Shots on Goal", value: 2 },
      { type: "expected_goals", value: "0.44" }
    ] }
  ], match);
  const analysis = apiFootball.buildLiveMatchAnalysis(match, statistics, events);

  assert.equal(lineups[0].players[0], "Oyuncu Bir");
  assert.equal(events[0].time, "37'");
  assert.equal(events[0].value, "Golcu · Asist: Asistci · Normal Goal");
  assert.equal(statistics.find((item) => item.type === "Ball Possession").home, "61%");
  assert.equal(analysis.confidence, "Yüksek");
  assert.ok(analysis.signals.length >= 6);
  assert.match(analysis.summary, /Ev SK/);

  const eventDrivenAnalysis = apiFootball.buildLiveMatchAnalysis(match, [], apiFootball.normalizeFixtureEvents([
    {
      time: { elapsed: 37 },
      team: { name: "Ev SK" },
      player: { name: "Golcu" },
      type: "Goal",
      detail: "Normal Goal"
    },
    {
      time: { elapsed: 52 },
      team: { name: "Ev SK" },
      player: { name: "Savunmaci" },
      type: "Card",
      detail: "Red Card"
    }
  ]));
  assert.equal(eventDrivenAnalysis.confidence, "Orta");
  assert.ok(eventDrivenAnalysis.signals.some((signal) => signal.label === "Disiplin dengesi"));
  assert.ok(eventDrivenAnalysis.signals.some((signal) => signal.label === "Gol akışı"));
}

async function testDateOnlyLeagueFiltering() {
  const previousFetch = global.fetch;
  const previousKey = process.env.APIFOOTBALL_API_KEY;
  let requestedUrl = "";

  try {
    process.env.APIFOOTBALL_API_KEY = "test-api-football-key";
    global.fetch = async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          errors: [],
          response: [
            {
              fixture: { id: 1, date: "2026-07-22T18:00:00Z", status: { short: "2H" } },
              league: { name: "UEFA Champions League" },
              teams: { home: { name: "Ev" }, away: { name: "Dep" } },
              goals: { home: 1, away: 0 }
            },
            {
              fixture: { id: 2, date: "2026-07-22T19:00:00Z", status: { short: "NS" } },
              league: { name: "Premier League" },
              teams: { home: { name: "Home" }, away: { name: "Away" } },
              goals: { home: null, away: null }
            }
          ]
        })
      };
    };

    const matches = await apiFootball.getMatches({
      date: "2026-07-22",
      league: 2,
      requestedCompetition: "sampiyonlar-ligi"
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].league, "UEFA Champions League");
    assert.match(requestedUrl, /date=2026-07-22/);
    assert.ok(!requestedUrl.includes("league="));
    assert.ok(!requestedUrl.includes("season="));
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.APIFOOTBALL_API_KEY;
    else process.env.APIFOOTBALL_API_KEY = previousKey;
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

    // Turnuva belirtilmeyen istekte football-data abonelikteki her ligi
    // döndürüyor; katalog dışı ligler günün maç listesine girmemeli.
    const unscoped = await footballData.getMatches({ date: "2026-05-24" });
    assert.deepEqual(unscoped.map((match) => match.league), ["Premier League"]);
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
testApiFootballErrorClassification();
testSeasonDerivation();
testProviderChainOrder();
testLiveMatchDetailNormalization();
await testPlayerLeagueSlugFallback();
await testDateOnlyLeagueFiltering();
await testFootballDataCompetitionFallback();
await testPlanErrorFailsOverToCuratedData();
await testCuratedAndCalendarMerge();
await testCuratedLeagueFilterUsesCatalog();

console.log("FutbolRadar API resilience tests passed");
