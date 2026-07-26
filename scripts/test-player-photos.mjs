/**
 * OYUNCU FOTOĞRAFI TESTLERİ
 *
 * Sözleşme:
 *   1. Yalnızca lisanslı kaynak: API-Football medya sunucusu. Başka hiçbir
 *      alan adı kabul edilmez — kazıma ve lisanssız görsel yok.
 *   2. Adres, gerçek sağlayıcı kimliğinden türetilebilir. Yer tutucu
 *      kimliklerden ("mock-...") TÜRETİLEMEZ: kırık görsel ya da daha
 *      kötüsü başka bir oyuncunun fotoğrafı demek olurdu.
 *   3. Fotoğraf yoksa yer tutucu; uydurma görsel yok.
 *   4. Alt metin dolu ve oyuncuyu tanımlıyor.
 *   5. İstemci (app.js) ile servis aynı kuralı uyguluyor.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const photo = require("../services/playerPhotoService.js");

function testOnlyLicensedHostIsAccepted() {
  assert.equal(
    photo.isAllowedPhotoUrl("https://media.api-sports.io/football/players/276.png"), true,
    "sağlayıcının medya sunucusu kabul edilmeli"
  );

  for (const url of [
    "https://example.com/player.png",
    "https://cdn.transfermarkt.de/player.png",
    "https://images.google.com/x.png",
    "http://media.api-sports.io/football/players/276.png",
    "https://media.api-sports.io.evil.test/276.png",
    "javascript:alert(1)",
    ""
  ]) {
    assert.equal(photo.isAllowedPhotoUrl(url), false, `"${url}" kabul edilmemeli`);
  }
}

function testStoredPhotoMustPassAllowlist() {
  const licensed = photo.resolvePlayerPhoto({
    name: "Test Oyuncu",
    photo: "https://media.api-sports.io/football/players/276.png"
  });
  assert.equal(licensed.source, "provider");
  assert.equal(licensed.isPlaceholder, false);

  // Veri dosyasına başka bir host düşerse yayına çıkmamalı.
  const unlicensed = photo.resolvePlayerPhoto({
    name: "Test Oyuncu",
    photo: "https://cdn.baskasite.com/oyuncu.jpg"
  });
  assert.equal(unlicensed.isPlaceholder, true, "lisanssız görsel yer tutucuya düşmeli");
  assert.equal(unlicensed.url, "", "lisanssız adres taşınmamalı");
}

function testDerivesFromRealProviderIdOnly() {
  const real = photo.resolvePlayerPhoto({ name: "Test", providerId: "276" });
  assert.equal(real.source, "derived");
  assert.equal(real.url, "https://media.api-sports.io/football/players/276.png");

  // Bu depodaki mevcut kimlikler yer tutucu; bunlardan adres üretilmemeli.
  for (const id of ["mock-icardi-9", "mock-kerem-7", "abc", "9-mock", ""]) {
    const derived = photo.resolvePlayerPhoto({ name: "Test", providerId: id });
    assert.equal(derived.isPlaceholder, true, `"${id}" kimliğinden adres üretilmemeli`);
  }
}

function testPlaceholderCarriesInitials() {
  const result = photo.resolvePlayerPhoto({ name: "Kerem Aktürkoğlu" });
  assert.equal(result.isPlaceholder, true);
  assert.equal(result.url, "", "yer tutucuda adres olmamalı");
  assert.ok(result.initials, "yer tutucu baş harf taşımalı");
  assert.equal(result.initials, "KA");

  // İsimsiz kayıt da kırılmamalı.
  assert.ok(photo.resolvePlayerPhoto({}).initials, "isimsiz kayıtta da baş harf üretilmeli");
}

function testAltTextDescribesThePlayer() {
  const alt = photo.playerPhotoAlt({ name: "Kerem Aktürkoğlu", currentTeam: "Galatasaray" });
  assert.ok(alt.includes("Kerem Aktürkoğlu"), "alt metin oyuncuyu adıyla anmalı");
  assert.ok(alt.includes("Galatasaray"), "takım bilgisi varsa alt metne girmeli");
  assert.ok(alt.trim().length > 5, "alt metin anlamlı olmalı");

  const withContext = photo.playerPhotoAlt({ name: "Test" }, "maç sonrası öne çıkan oyuncu");
  assert.ok(withContext.includes("maç sonrası"), "bağlam verildiğinde alt metne yansımalı");
}

function testClientMirrorsTheSameRules() {
  // Kural iki yerde yaşıyor: servis (üretim betikleri) ve app.js (tarayıcı).
  // Ayrışırlarsa sunucu yer tutucu basarken tarayıcı lisanssız bir adresi
  // yükleyebilir. Test host listesinin ve kimlik kalıbının aynı olduğunu
  // doğruluyor.
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

  assert.ok(
    app.includes('PLAYER_PHOTO_HOSTS = ["media.api-sports.io"]'),
    "app.js aynı host beyaz listesini taşımalı"
  );
  assert.ok(
    app.includes("https://media.api-sports.io/football/players"),
    "app.js aynı medya kalıbını kullanmalı"
  );
  assert.ok(
    /playerPhotoProviderId[\s\S]{0,220}\/\^\\d\+\$\//.test(app),
    "app.js yalnızca rakamdan oluşan sağlayıcı kimliğini kabul etmeli"
  );
  assert.ok(
    !app.includes('alt="" loading="lazy" decoding="async" /></span>'),
    "oyuncu kartındaki boş alt metin kalmamalı"
  );
}

function testRenderedMarkupIsLazyAndAccessible() {
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

  // Oyuncu kartı görselinde tembel yükleme, boyut ve dolu alt olmalı.
  const avatar = app.slice(app.indexOf("function playerAvatarHtml"), app.indexOf("function badgesHtml"));
  assert.ok(avatar.includes('loading="lazy"'), "tembel yükleme olmalı");
  assert.ok(avatar.includes('decoding="async"'), "çözümleme eşzamansız olmalı");
  assert.ok(avatar.includes('width="96" height="96"'), "boyut verilmeli — düzen kayması olmasın");
  assert.ok(avatar.includes("playerPhotoAlt"), "alt metin üretilmeli");
  assert.ok(avatar.includes("onerror"), "görsel düşerse baş harflere düşülmeli");
}

function testRealDataProducesPlaceholdersToday() {
  // Bugünün gerçek durumu: hiçbir kayıtta lisanslı fotoğraf ya da gerçek
  // sağlayıcı kimliği yok, dolayısıyla hepsi yer tutucuya düşüyor. Bu test
  // durumu SABİTLEMİYOR, yalnızca uydurma görsel üretilmediğini doğruluyor:
  // kadro senkronu gerçek kimlikleri getirdiğinde sayı kendiliğinden değişir.
  const players = require("../data/players.json");
  const list = Array.isArray(players) ? players : (players.players || []);

  for (const player of list) {
    const result = photo.resolvePlayerPhoto(player);
    if (!result.isPlaceholder) {
      assert.ok(
        photo.isAllowedPhotoUrl(result.url),
        `${player.name}: yalnızca lisanslı adres yayımlanabilir, alınan: ${result.url}`
      );
    }
  }
}

const tests = [
  testOnlyLicensedHostIsAccepted,
  testStoredPhotoMustPassAllowlist,
  testDerivesFromRealProviderIdOnly,
  testPlaceholderCarriesInitials,
  testAltTextDescribesThePlayer,
  testClientMirrorsTheSameRules,
  testRenderedMarkupIsLazyAndAccessible,
  testRealDataProducesPlaceholdersToday
];

for (const test of tests) {
  test();
}

console.log(`Player photo tests passed (${tests.length} senaryo: lisanslı host, beyaz liste, ` +
  "gerçek kimlikten türetme, yer tutucu, alt metin, istemci-servis tutarlılığı, tembel yükleme, gerçek veri).");
