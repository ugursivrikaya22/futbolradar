/**
 * DAĞITIM HAZIRLIĞI ve ANAHTAR SIZINTISI TESTLERİ
 *
 * İki ayrı soruyu birlikte kapatır:
 *
 *   1. GÜVENLİK — tanı yüzeyleri (sağlık ucu, ön kontrol, senkron
 *      günlükleri) anahtarın KENDİSİNİ hiçbir koşulda yazmamalı. Tanı
 *      çıktısı en çok paylaşılan şeydir: ekran görüntüsü olarak issue'ya,
 *      CI günlüğüne, destek talebine gider. Anahtar oraya bir kez düşerse
 *      geri alınamaz.
 *
 *      Bu yüzden test "anahtar yazılıyor mu" diye BAKMAZ; bilinen bir
 *      anahtarı ortama koyar, yüzeyi çalıştırır ve çıktının tamamında o
 *      değerin (ve anlamlı parçalarının) geçmediğini kanıtlar.
 *
 *   2. HAZIRLIK — dağıtımdan sonra "gerçek veri görünecek mi" sorusu tek
 *      istekle cevaplanabilmeli. Anahtarın tanımlı olması yetmiyor: ölçüm
 *      ayrı uç noktadan, ayrı koşuyla geliyor.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

/** Gerçek biçime birebir uyan sahte anahtar: 32 onaltılık karakter. */
const FAKE_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const KEY_ENV_NAMES = [
  "APIFOOTBALL_API_KEY",
  "API_FOOTBALL_API_KEY",
  "APIFOOTBALL_KEY",
  "API_SPORTS_API_KEY",
  "APISPORTS_API_KEY"
];

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runHandler(handler, req) {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) { if (body && !this.body) this.body = body; return this; }
  };
  await handler(req, res);
  return res;
}

/**
 * Sızıntı denetimi. Tam değeri aramak yetmez: anahtarın yarısı ya da
 * son sekiz karakteri de sızıntıdır ve bir saldırgan için kalanı
 * denemekten çok daha kolaydır.
 */
function assertNoKeyLeak(serialized, label) {
  assert.ok(
    !serialized.includes(FAKE_KEY),
    `${label}: anahtarın TAMAMI çıktıya sızdı`
  );
  const fragments = [
    FAKE_KEY.slice(0, 16),
    FAKE_KEY.slice(-16),
    FAKE_KEY.slice(0, 8),
    FAKE_KEY.slice(-8)
  ];
  for (const fragment of fragments) {
    assert.ok(
      !serialized.includes(fragment),
      `${label}: anahtar parçası çıktıya sızdı (${fragment.length} karakter)`
    );
  }
}

/* ------------------------------------------------------------------ *
 * 1. SAĞLIK UCU ANAHTARI ASLA YAZMAZ
 * ------------------------------------------------------------------ */

{
  // Her kabul edilen değişken adına aynı anda yaz: en kötü durum.
  const env = {};
  for (const name of KEY_ENV_NAMES) env[name] = FAKE_KEY;

  const res = await withEnv(env, async () => {
    // Sağlık ucu modül yükleme anında env okumuyor; yine de temiz yükleme
    // için önbelleği düşür.
    delete require.cache[require.resolve("../api/health.js")];
    const health = require("../api/health.js");
    return runHandler(health, { method: "GET", url: "/api/health", headers: {} });
  });

  const serialized = JSON.stringify(res.body);
  assertNoKeyLeak(serialized, "sağlık ucu");

  const diagnostics = res.body.data[0];

  // Anahtarın VARLIĞI ve BİÇİMİ bildirilmeli — teşhis için gerekli.
  assert.equal(diagnostics.apiFootball.credentialPresent, true, "anahtar varlığı bildirilmeli");
  assert.equal(diagnostics.apiFootball.configured, true, "yapılandırma bildirilmeli");
  assert.ok(diagnostics.apiFootball.credentialShape.length, "anahtar biçimi bildirilmeli");

  for (const shape of diagnostics.apiFootball.credentialShape) {
    assert.equal(shape.length, FAKE_KEY.length, "uzunluk bildirilmeli");
    assert.equal(shape.looksValidFormat, true, "biçim geçerliliği bildirilmeli");
    // Değerin kendisi HİÇBİR alanda olmamalı.
    assert.ok(!Object.values(shape).includes(FAKE_KEY), "biçim raporu değeri taşımamalı");
  }
}

/* ------------------------------------------------------------------ *
 * 2. BOŞLUKLU / TIRNAKLI ANAHTAR — teşhis edilir, yine sızmaz
 *
 * En sık kurulum hatası: panoya kopyalarken sona boşluk ya da tırnak
 * gelmesi. Sağlayıcı bunu "Missing application key" diye bildiriyor ve
 * ikisi ayırt edilemiyordu.
 * ------------------------------------------------------------------ */

{
  const messy = `  "${FAKE_KEY}"  `;
  const res = await withEnv({ APIFOOTBALL_API_KEY: messy }, async () => {
    delete require.cache[require.resolve("../api/health.js")];
    const health = require("../api/health.js");
    return runHandler(health, { method: "GET", url: "/api/health", headers: {} });
  });

  assertNoKeyLeak(JSON.stringify(res.body), "sağlık ucu (boşluklu/tırnaklı)");

  const shape = res.body.data[0].apiFootball.credentialShape[0];
  assert.equal(shape.hadSurroundingWhitespace, true, "sondaki boşluk teşhis edilmeli");
  assert.equal(shape.looksQuoted, true, "tırnak teşhis edilmeli");
  assert.equal(shape.looksValidFormat, false, "tırnaklı değer geçerli biçim sayılmamalı");
}

/* ------------------------------------------------------------------ *
 * 3. YAYIN HAZIRLIĞI RAPORU
 * ------------------------------------------------------------------ */

{
  delete require.cache[require.resolve("../api/health.js")];
  const health = require("../api/health.js");
  const res = await runHandler(health, { method: "GET", url: "/api/health", headers: {} });
  const diagnostics = res.body.data[0];

  const readiness = diagnostics.playerData;
  assert.ok(readiness, "sağlık ucu oyuncu veri hazırlığını bildirmeli");
  assert.equal(readiness.available, true, "oyuncu veri kümesi okunabilmeli");
  assert.ok(Number.isFinite(readiness.total), "toplam kayıt sayısı bildirilmeli");
  assert.ok(Number.isFinite(readiness.measuredRating), "ölçülmüş derece sayısı bildirilmeli");

  // Sözleşme: radar YALNIZCA ölçülmüş derece varsa dolu render edilir.
  assert.equal(
    readiness.radarWillRender,
    readiness.measuredRating > 0,
    "radarWillRender ölçülmüş derece sayısıyla tutarlı olmalı"
  );
  assert.ok(readiness.nextAction, "sonraki adım bildirilmeli");

  // ANAHTAR TANIMLI DEĞİLKEN DEĞİŞKEN ADLARI SAYILMAZ.
  //
  // Sağlık ucu tanı amaçlı paylaşılan bir yüzey (ekran görüntüsü, issue,
  // destek talebi). Yapılandırılmamış bir ortamda hangi değişkenlerin
  // arandığını saymak, saldırgana gereksiz bir ipucu verir. Kurulum
  // yönlendirmesi belgeye ait, tanı çıktısına değil.
  //
  // Bu tam olarak bir kez kaçtı: hazırlık raporuna eklenen "sonraki adım"
  // metni kurulum ipucu olarak değişken adını taşıyordu.
  const serializedDefault = JSON.stringify(diagnostics);
  for (const name of KEY_ENV_NAMES) {
    assert.ok(
      !serializedDefault.includes(name),
      `anahtar tanımlı değilken sağlık ucu değişken adını saymamalı: ${name}`
    );
  }
  assert.ok(
    !serializedDefault.includes("FOOTBALL_API_KEY"),
    "sağlık ucu anahtar değişken adı parçası taşımamalı"
  );

  // Kota koruması görünür olmalı.
  const cache = diagnostics.providerCache;
  assert.ok(cache, "önbellek durumu bildirilmeli");
  assert.ok(cache.liveTtlMs > 0 && cache.liveTtlMs <= 30000, "canlı TTL makul olmalı");
  assert.ok(cache.maxEntries > 0, "önbellek üst sınırı bildirilmeli");
}

/* ------------------------------------------------------------------ *
 * 4. TANI ARAÇLARI ANAHTARI GÜNLÜĞE YAZMAZ
 *
 * Kaynak düzeyinde denetim: bu betiklerin çıktısı CI günlüğüne gidiyor.
 * ------------------------------------------------------------------ */

for (const file of [
  "scripts/preflight-api-football.mjs",
  "scripts/sync-player-statistics.mjs",
  "scripts/sync-super-lig-squads.mjs"
]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");

  // Anahtar değerini doğrudan yazdıran bir çağrı olmamalı.
  assert.ok(
    !/console\.(log|warn|error)\([^)]*(apiKey|API_KEY|APIFOOTBALL_API_KEY)\b[^)]*\)/.test(source),
    `${file}: anahtar değeri günlüğe yazılıyor olabilir`
  );
  assert.ok(
    !/\$\{\s*(config\.)?apiKey\s*\}/.test(source),
    `${file}: anahtar şablon dizesine gömülüyor`
  );
}

/* ------------------------------------------------------------------ *
 * 5. ANAHTAR ÜÇ ORTAM İÇİN DE BELGELENMİŞ OLMALI
 *
 * Kadro ve istatistik senkronu CI'da koşuyor, site Vercel'de çalışıyor.
 * Yalnızca Vercel'e tanımlanmış bir anahtar kadroları doldurmaz; yalnızca
 * CI'a tanımlanmış bir anahtar canlı skoru çalıştırmaz. Eksik belge, bu
 * kurulumun en pahalı hatası.
 * ------------------------------------------------------------------ */

const setupDoc = fs.readFileSync(path.join(root, "docs", "api-football-setup.md"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const preflight = fs.readFileSync(path.join(root, "scripts", "preflight-api-football.mjs"), "utf8");

for (const [label, text] of [["docs/api-football-setup.md", setupDoc], [".env.example", envExample]]) {
  assert.ok(/APIFOOTBALL_API_KEY/.test(text), `${label}: anahtar adı geçmeli`);
  assert.ok(/GitHub Actions/i.test(text), `${label}: GitHub Actions kurulumu belgelenmeli`);
  assert.ok(/Vercel/i.test(text), `${label}: Vercel kurulumu belgelenmeli`);
}

// Vercel'de anahtar HEM Production HEM Preview'a tanımlanmalı: yalnızca
// Production'a tanımlanan anahtar, preview dağıtımlarını sessizce mock'a
// düşürür ve hata üretimde değil, gözden kaçan yerde ortaya çıkar.
const productionPreviewDocumented = [setupDoc, envExample, preflight].some((text) =>
  /Production\s*\+\s*Preview|Production ve Preview|Production, Preview/i.test(text)
);
assert.ok(
  productionPreviewDocumented,
  "Vercel için Production + Preview ortamlarının ikisi de belgelenmeli"
);

// Ön kontrol çıktısı üç yeri de adıyla söylemeli.
assert.ok(/GitHub Actions/i.test(preflight), "ön kontrol GitHub Actions'ı adıyla söylemeli");
assert.ok(/Vercel/i.test(preflight), "ön kontrol Vercel'i adıyla söylemeli");

/* ------------------------------------------------------------------ *
 * 6. CI ZİNCİRİ — senkron adımları anahtarı secret'tan almalı
 * ------------------------------------------------------------------ */

const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "match-analysis.yml"), "utf8");
assert.ok(
  /APIFOOTBALL_API_KEY:\s*\$\{\{\s*secrets\.APIFOOTBALL_API_KEY\s*\}\}/.test(workflow),
  "CI anahtarı repository secret'tan okumalı"
);
assert.ok(
  /sync-player-statistics\.mjs --apply/.test(workflow),
  "CI ölçülmüş istatistik senkronunu çalıştırmalı"
);
// Anahtar workflow dosyasına düz metin gömülmemeli.
assert.ok(
  !/APIFOOTBALL_API_KEY:\s*["']?[0-9a-f]{32}/i.test(workflow),
  "workflow dosyasına düz metin anahtar gömülmüş"
);

/* ------------------------------------------------------------------ *
 * 7. CANLI SKOR SUNUM SÖZLEŞMESİ — logo, lig gruplaması, Istanbul saati
 * ------------------------------------------------------------------ */

const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const providerSource = fs.readFileSync(
  path.join(root, "services", "providers", "apiFootballProvider.js"), "utf8");

// Logo: sağlayıcı alanı üretiyor, istemci aynı adı okuyor. İkisi ayrışırsa
// logo sessizce baş harflere düşer ve kimse fark etmez.
assert.ok(/homeTeamLogo: teamLogo\(homeTeam\)/.test(providerSource),
  "sağlayıcı ev sahibi logosunu taşımalı");
assert.ok(/awayTeamLogo: teamLogo\(awayTeam\)/.test(providerSource),
  "sağlayıcı deplasman logosunu taşımalı");
assert.ok(/match\[side \+ "TeamLogo"\]/.test(appSource),
  "istemci sağlayıcının logo alan adını okumalı");
// Logo yoksa baş harf yedeği: kırık görsel basılmaz.
assert.ok(/live-score-team-logo-fallback/.test(appSource),
  "logo yokken baş harf yedeği bulunmalı");

// Lig gruplaması.
assert.ok(/function renderMatchesByLeague/.test(appSource),
  "canlı skor lig bazında gruplanmalı");

// Istanbul saati: hem sağlayıcı hem istemci.
assert.ok(/timeZone: "Europe\/Istanbul"/.test(providerSource),
  "sağlayıcı saat biçimi Europe/Istanbul olmalı");
assert.ok(/function todayInIstanbul/.test(appSource),
  "istemci gün sınırı Europe/Istanbul olmalı");

// Canlı dakika ölçümden gelir.
assert.ok(/function liveMinuteLabel/.test(appSource), "canlı dakika etiketi bulunmalı");

console.log("OK dağıtım hazırlığı · anahtar sızıntısı (tam + parça, boşluklu/tırnaklı), " +
  "hazırlık raporu, üç ortam belgesi, CI secret bağlantısı, logo/lig/saat sözleşmesi");
