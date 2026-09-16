/**
 * CANLI MAÇ KURTARMA TESTLERİ
 * ---------------------------------------------------------------------------
 * Hepsi TEK bir üretim hatasının etrafında: maç oynanıyor, sağlayıcı golü
 * biliyor, FutbolRadar sayfası hâlâ "Başlamadı" diyor.
 *
 * Hata tek bir yerde değildi; zincirin dört ayrı halkasında aynı sonuca
 * çıkan dört ayrı kopma vardı. Bu dosya her halkayı ayrı ayrı sabitler ki
 * biri onarılırken diğeri sessizce geri gelmesin.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const apiFootball = require("../services/providers/apiFootballProvider.js");
const { clearProviderCache } = require("../services/providerCache.js");
const matchDetailHandler = require("../api/match-detail.js");
const { eventsSectionHtml } = require("./lib/matchSeoPage.mjs");

const API_KEY = "c".repeat(32);
const FIXTURE_ID = "1637566";
const KICKOFF = "2026-09-16T15:00:00+03:00";

/** API-Football fikstür yükü — testte anlamı olan alanlar dolu. */
function fixturePayload({ status, elapsed, home, away, events = [] }) {
  return {
    errors: [],
    response: [{
      fixture: { id: Number(FIXTURE_ID), date: KICKOFF, status: { short: status, elapsed }, venue: { name: "Test" } },
      // 206: Türkiye Kupası — yarışma kataloğunda tanımlı.
      league: { id: 206, name: "Türkiye Kupası", round: "1st Round" },
      teams: { home: { id: 1, name: "Galata" }, away: { id: 2, name: "Yalova Yeşilovaspor" } },
      goals: { home, away },
      events
    }]
  };
}

function goalEvent(minute, team, player, assist) {
  return {
    time: { elapsed: minute, extra: null },
    team: { id: 1, name: team },
    player: { id: 10, name: player },
    assist: { id: 11, name: assist },
    type: "Goal",
    detail: "Normal Goal"
  };
}

function emptyPayload() {
  return { errors: [], response: [] };
}

/**
 * Sahte sağlayıcı. `routes` yol adına göre yanıt verir; hangi yolların kaç
 * kez çağrıldığı `calls` içinde tutulur çünkü testlerin bir kısmı tam olarak
 * "hangi uç nokta soruldu" sorusunu denetliyor.
 */
function installFetch(routes) {
  const calls = [];
  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    const key = parsed.pathname.replace(/\/$/, "");
    calls.push({ path: key, params: Object.fromEntries(parsed.searchParams) });
    const route = routes[key];
    const body = typeof route === "function" ? route(Object.fromEntries(parsed.searchParams)) : route;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body || emptyPayload() };
  };
  return calls;
}

function withEnv(run) {
  const previous = { key: process.env.APIFOOTBALL_API_KEY, fetch: global.fetch };
  process.env.APIFOOTBALL_API_KEY = API_KEY;
  clearProviderCache();
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = previous.fetch;
      if (previous.key === undefined) delete process.env.APIFOOTBALL_API_KEY;
      else process.env.APIFOOTBALL_API_KEY = previous.key;
      clearProviderCache();
    });
}

/**
 * 1) MAÇ KİMLİKLE BULUNUR — GÜNÜN LİSTESİ BOŞ DÖNSE BİLE.
 *
 * Eski kod `date` sorguda varsa maçı YALNIZCA o günün fikstür listesinde
 * arıyordu. Maç SEO sayfalarının tamamı `fixtureId=...&date=...` gönderiyor,
 * yani üretimde HER maç sayfası bu yoldan geçiyordu. Liste katalog
 * süzgecinden geçtiği ya da sağlayıcı fikstürü başka bir takvim gününe
 * yazdığı için maç listede bulunamazsa `PROVIDER_NOT_FOUND` atılıyor, uç
 * nokta boş veriyle dönüyor ve sayfa maç öncesi damgasında donuyordu.
 */
async function testFixtureFoundByIdWhenDayListMisses() {
  await withEnv(async () => {
    const calls = installFetch({
      "/fixtures": (params) => (params.id ? fixturePayload({ status: "2H", elapsed: 63, home: 2, away: 1 }) : emptyPayload()),
      "/fixtures/events": { errors: [], response: [goalEvent(31, "Galata", "A. Yilmaz", "B. Demir")] },
      "/fixtures/statistics": emptyPayload(),
      "/fixtures/lineups": emptyPayload(),
      "/fixtures/players": emptyPayload()
    });

    const detail = await apiFootball.getMatchDetail({ fixtureId: FIXTURE_ID, date: "2026-09-16", includePredictions: false });

    assert.equal(detail.status, "LIVE", "sağlayıcı oynanıyor derken durum LIVE olmalı");
    assert.equal(detail.score.home, 2);
    assert.equal(detail.score.away, 1);
    assert.equal(detail.minute, 63, "oynanan dakika taşınmalı");
    assert.equal(detail.events.length, 1, "gol olayı taşınmalı");

    const byId = calls.filter((call) => call.path === "/fixtures" && call.params.id);
    assert.ok(byId.length >= 1, "fikstür kimliğiyle sorulmalı");
    const byDate = calls.filter((call) => call.path === "/fixtures" && call.params.date);
    assert.equal(byDate.length, 0, "kimlik yanıt verdiğinde günün listesi hiç istenmemeli");
  });
}

/**
 * 2) GOL VERİSİ TAM TAŞINIR: GOLCÜ, DAKİKA, TAKIM, ASİST.
 *
 * Maç sayfasındaki olaylar bölümünün sözleşmesi bu. Alanlardan biri
 * düşerse bölüm eksik çizilir ve kimse fark etmez.
 */
async function testGoalCarriesScorerMinuteTeamAndAssist() {
  await withEnv(async () => {
    installFetch({
      "/fixtures": fixturePayload({ status: "2H", elapsed: 63, home: 1, away: 0 }),
      "/fixtures/events": { errors: [], response: [goalEvent(31, "Galata", "A. Yilmaz", "B. Demir")] },
      "/fixtures/statistics": emptyPayload(),
      "/fixtures/lineups": emptyPayload(),
      "/fixtures/players": emptyPayload()
    });

    const detail = await apiFootball.getMatchDetail({ fixtureId: FIXTURE_ID, includePredictions: false });
    const goal = detail.events[0];

    assert.equal(goal.time, "31'", "gol dakikası");
    assert.equal(goal.team.name, "Galata", "golü atan takım");
    assert.ok(goal.value.includes("A. Yilmaz"), "golü atan oyuncu");
    assert.ok(/Asist:\s*B\. Demir/.test(goal.value), "asist yapan oyuncu");
  });
}

/**
 * 3) OLAY UÇ NOKTASI DÜŞERSE FİKSTÜR YÜKÜNDEKİ AKIŞ KULLANILIR.
 *
 * `/fixtures/events` çağrısı `.catch(() => [])` ile yutuluyor. Tek bir
 * zaman aşımı, sağlayıcı golü BİLDİĞİ hâlde olaylar bölümünü boşaltıyordu —
 * oysa aynı olaylar `/fixtures?id=` yanıtında zaten gömülü geliyor.
 */
async function testEventsFallBackToFixturePayload() {
  await withEnv(async () => {
    installFetch({
      "/fixtures": fixturePayload({
        status: "2H", elapsed: 70, home: 1, away: 0,
        events: [goalEvent(31, "Galata", "A. Yilmaz", "B. Demir")]
      }),
      "/fixtures/events": () => { throw new Error("olay uç noktası düştü"); },
      "/fixtures/statistics": emptyPayload(),
      "/fixtures/lineups": emptyPayload(),
      "/fixtures/players": emptyPayload()
    });

    const detail = await apiFootball.getMatchDetail({ fixtureId: FIXTURE_ID, includePredictions: false });
    assert.equal(detail.events.length, 1, "sağlayıcıda olay varken bölüm boş bırakılmamalı");
    assert.ok(detail.events[0].value.includes("A. Yilmaz"));
  });
}

/**
 * 4) KİMLİKLİ SORGU BOŞ DÖNERSE CANLI AKIŞ DENENİR.
 *
 * Oynanan bir maç tanım gereği `live=all` akışındadır. Kimlikli sorgu
 * geçici olarak boş dönse bile CANLI maç kaybolmamalı.
 */
async function testLiveStreamRecoversMissingFixture() {
  await withEnv(async () => {
    installFetch({
      "/fixtures": (params) => (params.live ? fixturePayload({ status: "1H", elapsed: 22, home: 0, away: 1 }) : emptyPayload()),
      "/fixtures/events": emptyPayload(),
      "/fixtures/statistics": emptyPayload(),
      "/fixtures/lineups": emptyPayload(),
      "/fixtures/players": emptyPayload()
    });

    const detail = await apiFootball.getMatchDetail({ fixtureId: FIXTURE_ID, date: "2026-09-16", includePredictions: false });
    assert.equal(detail.status, "LIVE", "canlı akıştaki maç bulunmalı");
    assert.equal(detail.score.away, 1);
  });
}

function fakeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
    end(payload) { this.payload = JSON.parse(payload); return this.payload; }
  };
}

/**
 * 5) İLK VURUŞ PENCERESİNDE YANIT ÖNBELLEKLENMEZ.
 *
 * Eski kural yalnızca sağlayıcı ZATEN "canlı" derken no-store'a geçiyordu.
 * Sağlayıcı durum kodunu geç günceller; o aralıkta maç öncesi yanıt
 * (s-maxage=30 + stale-while-revalidate=120) CDN'de donuyor ve maç
 * başladıktan sonra dakikalarca "Başlamadı" servis ediliyordu. Depoda bu
 * hatanın izi TEK bir fikstür kimliğinin koda elle yazılması olarak
 * duruyordu; kural artık her maç için geçerli.
 */
async function testKickoffWindowIsNeverCached() {
  await withEnv(async () => {
    const justStarted = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    installFetch({
      // Sağlayıcı hâlâ "başlamadı" diyor — düzeltilmesi gereken an tam da bu.
      "/fixtures": {
        errors: [],
        response: [{
          fixture: { id: Number(FIXTURE_ID), date: justStarted, status: { short: "NS", elapsed: null } },
          league: { id: 206, name: "Türkiye Kupası" },
          teams: { home: { id: 1, name: "Galata" }, away: { id: 2, name: "Yalova Yeşilovaspor" } },
          goals: { home: null, away: null }
        }]
      },
      "/fixtures/events": emptyPayload(),
      "/fixtures/statistics": emptyPayload(),
      "/fixtures/lineups": emptyPayload(),
      "/fixtures/players": emptyPayload()
    });

    const response = fakeResponse();
    await matchDetailHandler({
      method: "GET",
      url: `/api/match-detail?fixtureId=${FIXTURE_ID}`,
      headers: { "x-forwarded-for": "203.0.113.71" }
    }, response);

    assert.equal(response.headers["cdn-cache-control"], "no-store",
      "ilk vuruş penceresindeki yanıt CDN'de saklanmamalı");
  });
}

/**
 * 6) ÇÖZÜLEMEYEN KAYIT ÖNBELLEĞE YAZILMAZ.
 *
 * Geçici bir sağlayıcı kesintisi boş yanıt üretiyor; o boş yanıt
 * önbelleklenirse kesinti bittikten sonra bile dakikalarca "maç yok"
 * servis edilir.
 */
async function testEmptyDetailIsNeverCached() {
  await withEnv(async () => {
    installFetch({
      "/fixtures": emptyPayload(),
      "/fixtures/events": emptyPayload(),
      "/fixtures/statistics": emptyPayload(),
      "/fixtures/lineups": emptyPayload(),
      "/fixtures/players": emptyPayload()
    });

    const response = fakeResponse();
    await matchDetailHandler({
      method: "GET",
      url: "/api/match-detail?fixtureId=999999999",
      headers: { "x-forwarded-for": "203.0.113.72" }
    }, response);

    assert.deepEqual(response.payload.data, [], "kayıt yoksa uydurma veri dönmemeli");
    assert.equal(response.headers["cdn-cache-control"], "no-store", "boş yanıt önbelleklenmemeli");
  });
}

/**
 * 7) OLAY KABI BİTMİŞ MAÇTA DA BASILIR.
 *
 * Sağlayıcı olayları son düdükten dakikalar sonra yayımlıyor. Kap hiç
 * basılmazsa istemcinin geriye dönük tamamlaması yazacak yer bulamıyor ve
 * sayfa kalıcı olarak "ayrıntı yok" ile kalıyordu.
 */
function testFinishedPageKeepsEventContainer() {
  const html = eventsSectionHtml([], { locale: "tr", state: "post" });
  assert.ok(html.includes("data-msp-events-body"),
    "bitmiş ve olaysız maçta da olay kabı basılmalı (geriye dönük tamamlama için)");

  const english = eventsSectionHtml([], { locale: "en", state: "post" });
  assert.ok(english.includes("data-msp-events-body"), "İngilizce sayfada da aynı kap olmalı");
}

/**
 * 8) KİMLİKLİ SORGU YARIŞMA KATALOĞUNA TAKILMAZ.
 *
 * Katalog süzgeci "günün listesinde hangi maçlar öne çıksın" sorusunu
 * yanıtlar. "Şu kimlikteki maçı ver" diyen bir çağrıya uygulandığında,
 * kataloğa henüz girmemiş bir ligin maç sayfası sağlayıcı kaydı DÖNDÜRDÜĞÜ
 * hâlde "bulunamadı" sayılıyor ve canlı veriye hiç ulaşamıyordu.
 */
async function testUncatalogedLeagueStillResolvesById() {
  await withEnv(async () => {
    installFetch({
      "/fixtures": (params) => (params.id ? {
        errors: [],
        response: [{
          fixture: { id: Number(FIXTURE_ID), date: KICKOFF, status: { short: "2H", elapsed: 55 } },
          // 999: kataloğa girmemiş bir lig kimliği.
          league: { id: 999, name: "Bölgesel Amatör Lig" },
          teams: { home: { id: 1, name: "Galata" }, away: { id: 2, name: "Yalova Yeşilovaspor" } },
          goals: { home: 1, away: 1 }
        }]
      } : emptyPayload()),
      "/fixtures/events": emptyPayload(),
      "/fixtures/statistics": emptyPayload(),
      "/fixtures/lineups": emptyPayload(),
      "/fixtures/players": emptyPayload()
    });

    const detail = await apiFootball.getMatchDetail({ fixtureId: FIXTURE_ID, date: "2026-09-16", includePredictions: false });
    assert.equal(detail.status, "LIVE", "kataloğa girmemiş lig canlı veriyi engellememeli");
    assert.equal(detail.score.home, 1);
  });
}

await testFixtureFoundByIdWhenDayListMisses();
await testUncatalogedLeagueStillResolvesById();
await testGoalCarriesScorerMinuteTeamAndAssist();
await testEventsFallBackToFixturePayload();
await testLiveStreamRecoversMissingFixture();
await testKickoffWindowIsNeverCached();
await testEmptyDetailIsNeverCached();
testFinishedPageKeepsEventContainer();

console.log("FutbolRadar live match recovery tests passed");
