/**
 * API-FOOTBALL YAPILANDIRMA VE LİG ÇÖZÜMLEME TESTLERİ
 *
 * Bu depoda gerçek bir API anahtarı yok ve olmamalı. Ama "anahtar eklendiği
 * anda çalışacak" iddiası, sınanmadığı sürece bir iddiadan ibaret — kadro
 * senkronunun aylarca sessizce no-op etmesinin sebebi tam olarak buydu.
 *
 * Bu yüzden testler, API-Football protokolünü konuşan yerel bir HTTP sunucusu
 * kurar ve sağlayıcıyı ona yönlendirir (APIFOOTBALL_API_BASE_URL). Bu bir
 * TEST ÇİFTİDİR, siteye giden bir veri kaynağı değil: ürettiği hiçbir kayıt
 * data/ altına yazılmaz, hiçbir sayfaya çıkmaz. Amaç veri üretmek değil,
 * kod yolunun gerçekten çalıştığını kanıtlamak.
 *
 * Kapsanan sözleşme:
 *   1. Anahtar yoksa: çözümleme "no-api-key" ile durur, tahmin üretmez.
 *   2. Anahtar varsa ve lig kimliği yoksa: /leagues sorulur, Süper Lig
 *      bulunur, önbelleğe yazılır.
 *   3. Önbellek ikinci koşuda kullanılır; sağlayıcıya tekrar gidilmez.
 *   4. Env'deki lig kimliği her şeyin önündedir.
 *   5. Belirsizlik (aynı isimde iki lig) tahminle değil, durarak biter.
 *   6. Katalogda Süper Lig yoksa uydurulmaz.
 *   7. Anahtar hiçbir çıktıya, önbelleğe ya da hata mesajına sızmaz.
 *   8. Sezon env'den okunur, yoksa tarihten türetilir (bugün 2026).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SECRET_KEY = "abcdef0123456789abcdef0123456789";
const SUPER_LIG_ID = "203";

/** Sağlayıcının gördüğü her istek burada birikir; anahtar sızıntısı buradan denetlenir. */
let received = [];

function leagueEntry(id, name, type = "League", country = "Turkey") {
  return {
    league: { id: Number(id), name, type, logo: null },
    country: { name: country, code: "TR", flag: null },
    seasons: [{ year: 2026, current: true }]
  };
}

/**
 * API-Football protokolünü konuşan asgari sunucu. Yalnızca bu testlerin
 * dokunduğu uç noktaları tanır; tanımadığı yola boş yanıt döner.
 */
function startProviderDouble(routes) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    received.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: { ...req.headers }
    });

    if (req.headers["x-apisports-key"] !== SECRET_KEY) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ errors: ["Error/Missing application key."], response: [] }));
      return;
    }

    const handler = routes[url.pathname];
    const body = typeof handler === "function" ? handler(url) : { response: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** Her senaryo temiz bir modül grafiği ve temiz bir ortamla başlar. */
function freshResolver() {
  const providerPath = require.resolve("../services/providers/apiFootballProvider.js");
  const resolverPath = require.resolve("../services/leagueResolver.js");
  delete require.cache[providerPath];
  delete require.cache[resolverPath];
  return require(resolverPath);
}

function withEnv(vars, run) {
  const names = [
    "APIFOOTBALL_API_KEY", "API_FOOTBALL_API_KEY", "APIFOOTBALL_KEY",
    "API_FOOTBALL_KEY", "API_SPORTS_API_KEY", "APISPORTS_API_KEY",
    "APIFOOTBALL_LEAGUE_ID", "API_FOOTBALL_LEAGUE_ID", "APIFOOTBALL_LEAGUEID", "API_SPORTS_LEAGUE_ID",
    "APIFOOTBALL_API_BASE_URL", "API_FOOTBALL_API_BASE_URL", "APIFOOTBALL_BASE_URL", "API_FOOTBALL_BASE_URL",
    "APIFOOTBALL_SEASON", "API_FOOTBALL_SEASON",
    "APIFOOTBALL_COUNTRY", "API_FOOTBALL_COUNTRY"
  ];
  const backup = new Map(names.map((name) => [name, process.env[name]]));

  for (const name of names) delete process.env[name];
  Object.assign(process.env, vars);

  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const name of names) delete process.env[name];
      for (const [name, value] of backup) {
        if (value !== undefined) process.env[name] = value;
      }
    });
}

function tempCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "futbolradar-league-"));
  return path.join(dir, "api-football-league.json");
}

// ---------------------------------------------------------------------------

async function testNoKeyStopsWithoutGuessing() {
  const cachePath = tempCache();
  await withEnv({}, async () => {
    const { resolveSuperLigLeagueId } = freshResolver();
    const result = await resolveSuperLigLeagueId({ cachePath });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "no-api-key", "anahtar yokken sebep açıkça belirtilmeli");
    assert.equal(result.leagueId, null, "anahtar yokken lig kimliği uydurulmamalı");
    assert.ok(!fs.existsSync(cachePath), "çözülemeyen kimlik önbelleğe yazılmamalı");
  });
}

async function testEnvLeagueIdWins() {
  const cachePath = tempCache();
  received = [];
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": () => ({ response: [leagueEntry(999, "Süper Lig")] })
  });

  try {
    await withEnv({
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl,
      APIFOOTBALL_LEAGUE_ID: "555"
    }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();
      const result = await resolveSuperLigLeagueId({ cachePath });

      assert.equal(result.leagueId, "555", "env'deki kimlik her şeyin önünde olmalı");
      assert.equal(result.source, "env");
      assert.equal(received.length, 0, "env kimliği varken sağlayıcıya hiç gidilmemeli");
    });
  } finally {
    await closeServer(server);
  }
}

async function testAutoResolveAndCache() {
  const cachePath = tempCache();
  received = [];
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": () => ({
      response: [
        leagueEntry(204, "1. Lig"),
        leagueEntry(SUPER_LIG_ID, "Süper Lig"),
        leagueEntry(206, "2. Lig")
      ]
    })
  });

  try {
    await withEnv({
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl
    }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();

      const first = await resolveSuperLigLeagueId({ cachePath });
      assert.equal(first.status, "resolved");
      assert.equal(first.leagueId, SUPER_LIG_ID, "Süper Lig katalogdan seçilmeli");
      assert.equal(first.source, "provider");
      assert.equal(received.length, 1, "çözümleme tek çağrı yapmalı");
      assert.equal(received[0].path, "/leagues");

      // Önbellek yazıldı mı ve ikinci koşuda kullanılıyor mu?
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      assert.equal(String(cached.leagueId), SUPER_LIG_ID);
      assert.equal(cached.leagueName, "Süper Lig");

      const second = await resolveSuperLigLeagueId({ cachePath });
      assert.equal(second.leagueId, SUPER_LIG_ID);
      assert.equal(second.source, "cache", "ikinci çözümleme önbellekten gelmeli");
      assert.equal(received.length, 1, "önbellek varken sağlayıcıya tekrar gidilmemeli");
    });
  } finally {
    await closeServer(server);
  }
}

async function testAmbiguityStopsInsteadOfGuessing() {
  const cachePath = tempCache();
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": () => ({
      response: [leagueEntry(203, "Süper Lig"), leagueEntry(777, "Super Lig")]
    })
  });

  try {
    await withEnv({
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl
    }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();
      const result = await resolveSuperLigLeagueId({ cachePath });

      assert.equal(result.status, "unavailable");
      assert.equal(result.reason, "ambiguous-match", "iki eşleşmede tahmin edilmemeli");
      assert.equal(result.candidates.length, 2, "adaylar operatöre gösterilmeli");
      assert.ok(!fs.existsSync(cachePath), "belirsiz sonuç önbelleğe yazılmamalı");
    });
  } finally {
    await closeServer(server);
  }
}

async function testNoMatchDoesNotInventALeague() {
  const cachePath = tempCache();
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": () => ({ response: [leagueEntry(204, "1. Lig"), leagueEntry(206, "2. Lig")] })
  });

  try {
    await withEnv({
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl
    }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();
      const result = await resolveSuperLigLeagueId({ cachePath });

      assert.equal(result.status, "unavailable");
      assert.equal(result.reason, "no-match");
      assert.equal(result.leagueId, null, "eşleşme yokken ilk lig seçilmemeli");
      assert.ok(result.candidates.length, "operatöre adaylar gösterilmeli");
    });
  } finally {
    await closeServer(server);
  }
}

async function testProviderErrorIsReportedNotSwallowed() {
  const cachePath = tempCache();
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": () => ({ errors: ["Free plans do not have access to this season."], response: [] })
  });

  try {
    await withEnv({
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl
    }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();
      const result = await resolveSuperLigLeagueId({ cachePath });

      assert.equal(result.status, "unavailable");
      assert.ok(
        result.reason.startsWith("provider-error:"),
        `sağlayıcı hatası taşınmalı, "${result.reason}" alındı`
      );
      assert.ok(result.reason.includes("PLAN"), "paket hatası sınıflandırılmış olmalı");
    });
  } finally {
    await closeServer(server);
  }
}

async function testApiKeyNeverLeaks() {
  const cachePath = tempCache();
  received = [];
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": () => ({ response: [leagueEntry(SUPER_LIG_ID, "Süper Lig")] })
  });

  try {
    await withEnv({
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl
    }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();
      const result = await resolveSuperLigLeagueId({ cachePath });

      // Anahtar yalnızca başlıkta gitmeli; sorgu dizesine düşmemeli.
      for (const request of received) {
        assert.ok(
          !JSON.stringify(request.query).includes(SECRET_KEY),
          "anahtar sorgu parametresine yazılmamalı"
        );
      }

      // Önbellek dosyasında anahtar olmamalı.
      const cacheText = fs.readFileSync(cachePath, "utf8");
      assert.ok(!cacheText.includes(SECRET_KEY), "anahtar önbelleğe yazılmamalı");

      // Döndürülen nesnenin hiçbir alanında anahtar olmamalı.
      assert.ok(!JSON.stringify(result).includes(SECRET_KEY), "anahtar sonuç nesnesine sızmamalı");
    });
  } finally {
    await closeServer(server);
  }
}

async function testSeasonDefaultsToCurrentSeason() {
  await withEnv({ APIFOOTBALL_API_KEY: SECRET_KEY }, async () => {
    const providerPath = require.resolve("../services/providers/apiFootballProvider.js");
    delete require.cache[providerPath];
    const provider = require(providerPath);

    // Temmuz sonrası, sezon o yılın rakamıyla anılır: 2026-27 sezonu "2026".
    assert.equal(provider.seasonForDate("2026-07-26"), "2026");
    assert.equal(provider.seasonForDate("2027-03-01"), "2026", "mart hâlâ 2026 sezonu");
    assert.equal(provider.getConfig().season, provider.seasonForDate(), "env yoksa tarihten türetilmeli");
  });

  await withEnv({ APIFOOTBALL_API_KEY: SECRET_KEY, APIFOOTBALL_SEASON: "2025" }, async () => {
    const providerPath = require.resolve("../services/providers/apiFootballProvider.js");
    delete require.cache[providerPath];
    const provider = require(providerPath);
    assert.equal(provider.getConfig().season, "2025", "env sezonu türetmeyi ezmeli");
  });
}

async function testCorruptCacheIsIgnored() {
  const cachePath = tempCache();
  // Bir şekilde anahtar benzeri bir değer önbelleğe düşerse kullanılmamalı.
  fs.writeFileSync(cachePath, JSON.stringify({ leagueId: SECRET_KEY, country: "Turkey" }), "utf8");

  await withEnv({}, async () => {
    const { resolveSuperLigLeagueId } = freshResolver();
    const result = await resolveSuperLigLeagueId({ cachePath });
    assert.notEqual(result.leagueId, SECRET_KEY, "anahtar şeklindeki önbellek değeri lig kimliği sayılmamalı");
    assert.equal(result.status, "unavailable");
  });
}

async function testSponsoredNameStillResolves() {
  // Sponsor adı değişirse ("Trendyol Süper Lig") kurulum elle müdahale
  // beklemeden çalışmaya devam etmeli.
  const cachePath = tempCache();
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": () => ({
      response: [leagueEntry(204, "1. Lig"), leagueEntry(SUPER_LIG_ID, "Trendyol Süper Lig")]
    })
  });

  try {
    await withEnv({ APIFOOTBALL_API_KEY: SECRET_KEY, APIFOOTBALL_API_BASE_URL: baseUrl }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();
      const result = await resolveSuperLigLeagueId({ cachePath });
      assert.equal(result.leagueId, SUPER_LIG_ID, "sponsorlu ad da çözülmeli");
    });
  } finally {
    await closeServer(server);
  }
}

async function testLooseMatchStillRefusesToGuess() {
  // Genişletilmiş arama, tahmin etme iznine dönüşmemeli. Bilinen adlardan
  // hiçbiri tam tutmadığında iki isim birden "super lig" içeriyorsa
  // çözümleme durmalı.
  //
  // Not: adlardan biri bilinen listede olsaydı tam eşleşme kazanır ve bu
  // doğru olurdu — tam ad, alt dize benzerliğinden güçlü bir kanıttır.
  // Bu yüzden senaryo bilerek iki BİLİNMEYEN ad kullanır. İkisi de erkek A
  // takımı ligi görünümünde; kadınlar/altyapı süzgeci burada devreye girmez,
  // ayırt etmenin bir yolu yoktur ve doğru davranış durmaktır.
  const cachePath = tempCache();
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": () => ({
      response: [
        leagueEntry(SUPER_LIG_ID, "Süper Lig 2026-27"),
        leagueEntry(888, "Süper Lig Beyaz Grup")
      ]
    })
  });

  try {
    await withEnv({ APIFOOTBALL_API_KEY: SECRET_KEY, APIFOOTBALL_API_BASE_URL: baseUrl }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();
      const result = await resolveSuperLigLeagueId({ cachePath });

      assert.equal(result.status, "unavailable", "iki aday varken seçim yapılmamalı");
      assert.equal(result.reason, "ambiguous-match");
      assert.equal(result.candidates.length, 2, "her iki aday da gösterilmeli");
      assert.ok(!fs.existsSync(cachePath), "belirsiz sonuç önbelleğe yazılmamalı");
    });
  } finally {
    await closeServer(server);
  }
}

async function testNarrowQueryFallsBackToCountryOnly() {
  // Dar sorgu (type+season) boş dönerse yalnızca ülkeyle bir kez daha
  // sorulmalı; "katalogda yok" teşhisi fazla dar bir sorgudan doğmamalı.
  const cachePath = tempCache();
  received = [];
  const { server, baseUrl } = await startProviderDouble({
    "/leagues": (url) => url.searchParams.get("type")
      ? { response: [] }
      : { response: [leagueEntry(SUPER_LIG_ID, "Süper Lig")] }
  });

  try {
    await withEnv({ APIFOOTBALL_API_KEY: SECRET_KEY, APIFOOTBALL_API_BASE_URL: baseUrl }, async () => {
      const { resolveSuperLigLeagueId } = freshResolver();
      const result = await resolveSuperLigLeagueId({ cachePath });

      assert.equal(result.leagueId, SUPER_LIG_ID, "geniş sorgu ligi bulmalı");
      assert.equal(received.length, 2, "dar sorgu boş dönünce tam olarak bir kez daha sorulmalı");
      assert.ok(received[0].query.type, "ilk sorgu daraltılmış olmalı");
      assert.ok(!received[1].query.type, "ikinci sorgu yalnızca ülkeyle yapılmalı");
    });
  } finally {
    await closeServer(server);
  }
}

async function testRuntimeUsesCachedLeagueId() {
  // Otomatik çözümlemenin faydası kadro senkronuyla sınırlı kalmamalı:
  // /api/matches, /api/standings ve sezon fikstürü de env değişkeni olmadan
  // doğru ligi kullanabilmeli. Sağlayıcı, commit edilmiş önbelleği okur.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "futbolradar-runtime-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "data", "api-football-league.json"),
    JSON.stringify({ leagueId: SUPER_LIG_ID, leagueName: "Süper Lig", country: "Turkey" }),
    "utf8"
  );

  received = [];
  // Sunucu, kendisine hangi lig kimliğinin gönderildiğini kaydeder; iddia
  // "hata vermedi" değil, "DOĞRU ligi sordu" olur.
  const { server, baseUrl } = await startProviderDouble({
    "/fixtures": () => ({ response: [] })
  });

  const previousCwd = process.cwd();
  try {
    process.chdir(dir);
    await withEnv({ APIFOOTBALL_API_KEY: SECRET_KEY, APIFOOTBALL_API_BASE_URL: baseUrl }, async () => {
      const providerPath = require.resolve("../services/providers/apiFootballProvider.js");
      delete require.cache[require.resolve("../services/leagueCache.js")];
      delete require.cache[providerPath];
      const provider = require(providerPath);

      // Env'de lig kimliği yok; sağlayıcı yine de çözülmüş kimliği bulmalı.
      assert.equal(provider.getConfig().leagueId, "", "ön koşul: env'de kimlik olmamalı");

      await provider.getSeasonFixtures({ season: "2026" });

      const fixtureCall = received.find((request) => request.path === "/fixtures");
      assert.ok(fixtureCall, "sezon fikstürü sorgusu yapılmalı");
      assert.equal(
        fixtureCall.query.league,
        SUPER_LIG_ID,
        "sağlayıcı, env'de kimlik yokken önbellekteki ligi sormalı"
      );
    });
  } finally {
    process.chdir(previousCwd);
    await closeServer(server);
    fs.rmSync(dir, { recursive: true, force: true });
    delete require.cache[require.resolve("../services/leagueCache.js")];
    delete require.cache[require.resolve("../services/providers/apiFootballProvider.js")];
  }
}

async function testLooseMatchNeverPicksWomensOrYouthLeague() {
  // Gevşek eşleşmenin en tehlikeli hâli: "Süper Lig" geçen TEK aday bir
  // kadınlar ya da altyapı ligi olduğunda. Tek aday olduğu için belirsizlik
  // kontrolüne takılmaz — seçilirse on sekiz erkek A takımı yerine bambaşka
  // bir turnuvanın kadroları yayımlanır.
  for (const name of ["Kadınlar Süper Ligi", "U19 Süper Lig", "Süper Lig Play-Off"]) {
    const cachePath = tempCache();
    const { server, baseUrl } = await startProviderDouble({
      "/leagues": () => ({ response: [leagueEntry(901, name), leagueEntry(204, "1. Lig")] })
    });

    try {
      await withEnv({ APIFOOTBALL_API_KEY: SECRET_KEY, APIFOOTBALL_API_BASE_URL: baseUrl }, async () => {
        const { resolveSuperLigLeagueId } = freshResolver();
        const result = await resolveSuperLigLeagueId({ cachePath });

        assert.equal(result.status, "unavailable", `"${name}" Süper Lig sayılmamalı`);
        assert.notEqual(result.leagueId, "901", `"${name}" seçilmemeli`);
        assert.ok(!fs.existsSync(cachePath), `"${name}" önbelleğe yazılmamalı`);
      });
    } finally {
      await closeServer(server);
    }
  }
}

async function testStaleCacheIsRevalidated() {
  const { cacheIsUsable, CACHE_REVALIDATE_DAYS } = freshResolver();
  const now = new Date("2026-07-26T12:00:00Z");

  const fresh = { leagueId: "203", country: "Turkey", resolvedAt: "2026-07-20T12:00:00Z" };
  assert.equal(cacheIsUsable(fresh, "Turkey", now), true, "yeni önbellek kullanılmalı");

  const stale = new Date(now);
  stale.setDate(stale.getDate() - (CACHE_REVALIDATE_DAYS + 5));
  const old = { leagueId: "203", country: "Turkey", resolvedAt: stale.toISOString() };
  assert.equal(cacheIsUsable(old, "Turkey", now), false,
    "eski önbellek yeniden doğrulanmalı; yanlış bir kimlik depoya kalıcı donmamalı");

  const otherCountry = { leagueId: "203", country: "Spain", resolvedAt: "2026-07-20T12:00:00Z" };
  assert.equal(cacheIsUsable(otherCountry, "Turkey", now), false, "başka ülkenin önbelleği kullanılmamalı");
}

function testLeagueIdentityGuardRejectsWrongLeague() {
  const require2 = createRequire(import.meta.url);
  const { evaluateLeagueIdentity } = require2("../services/teamSyncService.js");
  const { fixtureTeamNames } = require2("../services/superLigTeams.js");

  const real = fixtureTeamNames().map((name) => ({ name }));
  const correct = evaluateLeagueIdentity(real);
  assert.equal(correct.safe, true, "gerçek Süper Lig listesi kabul edilmeli");

  // Doğru SAYIDA ama bambaşka takımlar: sayı koruması bunu yakalayamaz.
  const wrongLeague = real.map((_, index) => ({ name: `Yabancı Kulüp ${index + 1}` }));
  const rejected = evaluateLeagueIdentity(wrongLeague);
  assert.equal(rejected.safe, false, "yanlış ligin takımları reddedilmeli");
  assert.ok(/league-identity-mismatch/.test(rejected.reason), `beklenen gerekçe, alınan: ${rejected.reason}`);

  // Sezon arası birkaç takım değişebilir; çoğunluk tutuyorsa geçmeli.
  const mostlyRight = real.slice(0, real.length - 3)
    .concat([{ name: "Yeni Çıkan A" }, { name: "Yeni Çıkan B" }, { name: "Yeni Çıkan C" }]);
  assert.equal(evaluateLeagueIdentity(mostlyRight).safe, true, "küme değişiklikleri engellenmemeli");

  // Boş çekim her zaman reddedilmeli. evaluateTeamListChange bunu yalnızca
  // önceden takım varsa yakalıyor; previousCount 0 iken tüm korumaları
  // atlıyordu ve sıfır takım "başarılı senkron" sayılıyordu.
  const empty = evaluateLeagueIdentity([]);
  assert.equal(empty.safe, false, "boş çekim reddedilmeli");
  assert.equal(empty.reason, "empty-fetch-result");
}

const tests = [
  testNoKeyStopsWithoutGuessing,
  testRuntimeUsesCachedLeagueId,
  testLooseMatchNeverPicksWomensOrYouthLeague,
  testStaleCacheIsRevalidated,
  testLeagueIdentityGuardRejectsWrongLeague,
  testSponsoredNameStillResolves,
  testLooseMatchStillRefusesToGuess,
  testNarrowQueryFallsBackToCountryOnly,
  testEnvLeagueIdWins,
  testAutoResolveAndCache,
  testAmbiguityStopsInsteadOfGuessing,
  testNoMatchDoesNotInventALeague,
  testProviderErrorIsReportedNotSwallowed,
  testApiKeyNeverLeaks,
  testSeasonDefaultsToCurrentSeason,
  testCorruptCacheIsIgnored
];

for (const test of tests) {
  await test();
}

console.log(`API-Football config tests passed (${tests.length} senaryo: anahtar yokluğu, env önceliği, ` +
  "otomatik çözümleme, önbellek, belirsizlik, eşleşmeme, sponsorlu ad, dar sorgu geri dönüşü, " +
  "kadınlar/altyapı ligi süzgeci, önbellek yeniden doğrulama, lig kimliği koruması, " +
  "çalışma anında önbellek, sağlayıcı hatası, anahtar sızıntısı, sezon).");
