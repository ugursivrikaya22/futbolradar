/**
 * Sağlayıcı kimliği ve fikstür eşleştirme testleri.
 *
 * Korunan davranışlar:
 *   1. Bir sağlayıcının kimliği başka sağlayıcıya gönderilmez.
 *   2. Belirsiz/zayıf eşleşmede kimlik YAZILMAZ — yanlış eşleşme, bir maçın
 *      istatistiklerini başka maça işlemek demektir.
 *   3. Canlı skor sorgusu API-Football'ın gerçek zamanlı uç noktasını kullanır.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  API_FOOTBALL,
  THE_SPORTS_DB,
  isApiFootballId,
  providerIdFor,
  withProviderId,
  coverageReport
} = require("../services/providerIdentityService.js");
const { matchFixture, nameSimilarity } = require("../services/fixtureMatchingService.js");
const apiFootball = require("../services/providers/apiFootballProvider.js");
const utils = require("../api/_utils.js");

function testIdNamespacing() {
  // TheSportsDB olay numarası API-Football kimliği olarak OKUNMAMALI
  const calendarRecord = { id: "x", providerId: "2539612", source: "thesportsdb" };
  assert.equal(providerIdFor(calendarRecord, THE_SPORTS_DB), "2539612");
  assert.equal(providerIdFor(calendarRecord, API_FOOTBALL), null, "TheSportsDB kimliği API-Football'a verilmemeli");

  // Opak kimlik hiçbir sayısal alana geçmemeli
  const opaque = { id: "y", providerId: "blx8udpkfd48ndx9a93jskg0k", source: "manual_verified" };
  assert.equal(providerIdFor(opaque, API_FOOTBALL), null);

  assert.equal(isApiFootballId("1035432"), true);
  assert.equal(isApiFootballId("blx8ud"), false);
  assert.equal(isApiFootballId(""), false);
}

function testWithProviderIdGuards() {
  const base = { id: "m1" };
  const ok = withProviderId(base, API_FOOTBALL, "1035432");
  assert.equal(ok.changed, true);
  assert.equal(ok.record.providerIds.apiFootball, "1035432");

  // Sayısal olmayan değer reddedilir
  const bad = withProviderId(base, API_FOOTBALL, "abc123");
  assert.equal(bad.changed, false);
  assert.match(bad.conflict, /sayısal olmalı/);

  // Farklı bir kimlik sessizce ezilmez
  const conflict = withProviderId(ok.record, API_FOOTBALL, "999999");
  assert.equal(conflict.changed, false);
  assert.match(conflict.conflict, /çakışıyor/);

  // Aynı kimlik tekrar yazılırsa değişiklik yok
  assert.equal(withProviderId(ok.record, API_FOOTBALL, "1035432").changed, false);
}

function testNameSimilarity() {
  assert.ok(nameSimilarity("Beşiktaş", "Besiktas JK") > 0.8);
  assert.ok(nameSimilarity("FC Midtjylland", "Midtjylland") > 0.8);
  assert.ok(nameSimilarity("Galatasaray", "Fenerbahçe") < 0.4);
}

function testFixtureMatching() {
  const local = {
    id: "besiktas-fc-midtjylland-2026-07-23",
    homeTeam: "Beşiktaş",
    awayTeam: "FC Midtjylland",
    kickoff: "2026-07-23T21:00:00+03:00"
  };
  const candidates = [
    { providerId: "1035432", homeTeam: "Besiktas", awayTeam: "Midtjylland", kickoff: "2026-07-23T18:00:00+00:00" },
    { providerId: "1035433", homeTeam: "Galatasaray", awayTeam: "Monza", kickoff: "2026-07-23T18:00:00+00:00" }
  ];
  const result = matchFixture(local, candidates);
  assert.equal(result.status, "matched");
  assert.equal(result.candidate.providerId, "1035432");

  // Farklı gün -> eşleşme yok
  assert.equal(matchFixture({ ...local, kickoff: "2026-07-30T21:00:00+03:00" }, candidates).status, "none");

  // Nötr sahada taraflar ters verilmiş olabilir
  const swapped = matchFixture(local, [
    { providerId: "777", homeTeam: "Midtjylland", awayTeam: "Besiktas", kickoff: "2026-07-23T18:00:00+00:00" }
  ]);
  assert.equal(swapped.status, "matched");
  assert.equal(swapped.sidesSwapped, true);

  // Aynı iki takım aynı gün iki kez listelenirse yazma YAPILMAMALI
  const ambiguous = matchFixture(local, [
    { providerId: "1", homeTeam: "Besiktas", awayTeam: "Midtjylland", kickoff: "2026-07-23T18:00:00+00:00" },
    { providerId: "2", homeTeam: "Besiktas", awayTeam: "Midtjylland", kickoff: "2026-07-23T20:00:00+00:00" }
  ]);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.candidate, null);

  // Alakasız adaylar eşiği geçmemeli
  assert.equal(matchFixture(local, [
    { providerId: "3", homeTeam: "Konyaspor", awayTeam: "Hull City", kickoff: "2026-07-23T18:00:00+00:00" }
  ]).status, "none");
}

function testCoverageReport() {
  const rows = [
    { id: "a", providerIds: { apiFootball: "1" } },
    { id: "b", providerId: "2539612", source: "thesportsdb" },
    { id: "c" }
  ];
  const report = coverageReport(rows, API_FOOTBALL);
  assert.equal(report.total, 3);
  assert.equal(report.covered, 1);
  assert.deepEqual(report.missingIds.sort(), ["b", "c"]);
}

/** Canlı skor doğru uç noktayı ve parametreyi kullanmalı. */
async function testLiveEndpointUsage() {
  const previousFetch = global.fetch;
  const previousKey = process.env.APIFOOTBALL_API_KEY;
  const calls = [];

  try {
    process.env.APIFOOTBALL_API_KEY = "0123456789abcdef0123456789abcdef";
    global.fetch = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ errors: [], response: [] }) };
    };

    await apiFootball.getMatches({ live: "all" });
    const liveCall = calls[calls.length - 1];
    assert.match(liveCall, /\/fixtures\?/, "canlı sorgu /fixtures uç noktasını kullanmalı");
    assert.match(liveCall, /live=all/, "canlı sorgu live=all parametresini göndermeli");
    assert.ok(!/date=/.test(liveCall), "canlı sorguda tarih parametresi olmamalı (tüm günü çekmek kotayı harcar)");

    await apiFootball.getMatches({ date: "2026-07-25" });
    const dateCall = calls[calls.length - 1];
    assert.match(dateCall, /date=2026-07-25/, "günlük liste tarih parametresiyle çekilmeli");
    assert.ok(!/live=/.test(dateCall), "günlük listede live parametresi olmamalı");
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.APIFOOTBALL_API_KEY;
    else process.env.APIFOOTBALL_API_KEY = previousKey;
  }
}


/**
 * Canlı skor için API'den gelmesi beklenen alanlar: takım adı, logo, saat,
 * skor, durum (LIVE / HALFTIME / FINISHED) ve oynanan dakika.
 */
function testLiveFixtureNormalization() {
  const fixture = (short, elapsed) => apiFootball.normalizeFixture({
    fixture: { id: 991, date: "2026-07-25T18:00:00+00:00", status: { short, elapsed } },
    league: { name: "Süper Lig", round: "Regular Season - 3" },
    teams: {
      home: { name: "Galatasaray", logo: "https://media.api-sports.io/football/teams/645.png" },
      away: { name: "Fenerbahçe", logo: "https://media.api-sports.io/football/teams/611.png" }
    },
    goals: { home: 2, away: 1 }
  });

  const firstHalf = fixture("1H", 37);
  assert.equal(firstHalf.status, "LIVE");
  assert.equal(firstHalf.live, true);
  assert.equal(firstHalf.minute, 37, "oynanan dakika fixture'dan okunmali");
  assert.equal(firstHalf.homeTeam, "Galatasaray");
  assert.equal(firstHalf.homeTeamLogo, "https://media.api-sports.io/football/teams/645.png");
  assert.equal(firstHalf.awayTeamLogo, "https://media.api-sports.io/football/teams/611.png");
  assert.deepEqual(firstHalf.score, { home: 2, away: 1 });
  assert.equal(firstHalf.providerId, "991");
  assert.ok(firstHalf.time, "baslama saati TSI olarak uretilmeli");

  // Devre arasi LIVE'a ezilmemeli ama hala in-play sayilmali
  const half = fixture("HT", 45);
  assert.equal(half.status, "HALFTIME", "devre arasi ayri durum olmali");
  assert.equal(half.live, true, "devre arasi hala in-play");

  const done = fixture("FT", 90);
  assert.equal(done.status, "FINISHED");
  assert.equal(done.live, false);
}

/** Canlı yanıt, günlük listeden belirgin şekilde kısa ömürlü olmalı. */
function testLiveCachePolicy() {
  const daily = utils.cacheControlFor("matches");
  const live = utils.cacheControlFor("matches-live");
  const age = (value) => Number(String(value).match(/s-maxage=(\d+)/)[1]);
  assert.ok(age(live.cdn) < age(daily.cdn), "canli yanit gunluk listeden kisa onbelleklenmeli");
  assert.ok(age(live.cdn) <= 15, "canli skor icin 15 saniyeden uzun CDN onbellegi kabul edilemez");
}


/**
 * API-Sports'un iki farklı "missing application key" metni ayırt edilmeli:
 * biri anahtarın header'a hiç konmadığını, diğeri anahtarın tanınmadığını
 * söyler. Tek koda düşürülünce teşhis yanlış yöne gidiyordu.
 */
function testCredentialErrorClassification() {
  const headerMissing = apiFootball.classifyPayloadError([
    "Missing application key, Check our documentation on how to add your API key in headers."
  ]);
  assert.equal(headerMissing.code, "PROVIDER_CREDENTIAL_NOT_SENT");

  const keyRejected = apiFootball.classifyPayloadError([
    "Error/Missing application key. Go to https://www.api-football.com/documentation-v3 to learn how to get your API application key."
  ]);
  assert.equal(keyRejected.code, "PROVIDER_AUTH_ERROR");

  const suspended = apiFootball.classifyPayloadError([
    "Your account is suspended, check on https://dashboard.api-football.com."
  ]);
  assert.equal(suspended.code, "PROVIDER_ACCOUNT_SUSPENDED");
}

testIdNamespacing();
testWithProviderIdGuards();
testCredentialErrorClassification();
testNameSimilarity();
testFixtureMatching();
testCoverageReport();
await testLiveEndpointUsage();
testLiveFixtureNormalization();
testLiveCachePolicy();

console.log("Provider identity tests passed (kimlik isim alanı, eşleştirme eşikleri, belirsizlik koruması, canlı uç nokta).");
