/**
 * LİGİN ADI TESTLERİ
 *
 * Sözleşme:
 *   1. Kullanıcıya görünen her yerde tek doğru ad yazılır: "Trendyol Süper Lig".
 *   2. Eski ve yanlış yazımlar ("Süper Lig", "Turkcell Süper Lig", "Türk
 *      Süper Ligi", "Spor Toto Süper Lig") EŞLEŞME için tanınır ama hiçbiri
 *      ekrana basılmaz.
 *   3. İÇ ANAHTARLAR değişmez: competitionId "super-lig", dosya adları,
 *      URL'ler ve sağlayıcı lig kimlikleri adresleme aracıdır; sponsor adı
 *      değiştiğinde bunların kırılması gerekmez.
 *   4. İstemci (app.js) ile servis aynı kuralı uygular; ayrışırsa kullanıcı
 *      JS yüklenmeden önce ve sonra farklı bir lig adı okur.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  SUPER_LIG_DISPLAY_NAME,
  SUPER_LIG_NAME_VARIANTS,
  displayLeagueName,
  isSuperLigName
} = require("../services/leagueIdentity.js");

/** Görünür metinde asla bulunamayacak yazımlar. */
const WRONG_LABELS = [
  /Turkcell\s+Süper\s+Lig/i,
  /Spor\s+Toto\s+Süper\s+Lig/i,
  /Türk\s+Süper\s+Ligi/i,
  /Türkiye\s+Süper\s+Ligi/i,
  /Turkish\s+Super\s+Lig(ue)?/i
];

/** "Trendyol" öneki olmayan çıplak yazım. */
const BARE_LABEL = /(?<!Trendyol )Süper Lig/;

function testCanonicalName() {
  assert.equal(SUPER_LIG_DISPLAY_NAME, "Trendyol Süper Lig");
  assert.ok(
    SUPER_LIG_NAME_VARIANTS.includes(SUPER_LIG_DISPLAY_NAME),
    "doğru ad, tanınan yazımlar listesinde de bulunmalı"
  );
}

function testVariantsResolveToOneName() {
  for (const variant of SUPER_LIG_NAME_VARIANTS) {
    assert.ok(isSuperLigName(variant), `"${variant}" tanınmalı`);
    assert.equal(
      displayLeagueName(variant),
      SUPER_LIG_DISPLAY_NAME,
      `"${variant}" tek doğru ada dönmeli`
    );
  }

  // Yazım varyantları: aksan, tire, büyük/küçük harf.
  for (const value of ["süper lig", "SÜPER LİG", "super-lig", "Trendyol Super Lig"]) {
    assert.equal(displayLeagueName(value), SUPER_LIG_DISPLAY_NAME, `"${value}" tek doğru ada dönmeli`);
  }
}

/**
 * TANINMAYAN LİGLER DOKUNULMADAN GEÇMELİ — denetleyici aşırı yakalamamalı.
 *
 * Kapsam genişledi: artık üç UEFA turnuvası da tek biçime çevriliyor
 * (aşağıdaki testUefaCompetitionsAreCanonical). Ama tanınmayan her ad OLDUĞU
 * GİBİ kalmalı — uydurma bir turnuva adı üretmek, yanlış adı düzeltmekten
 * daha kötüdür.
 */
function testOtherLeaguesPassThrough() {
  for (const value of ["Premier League", "1. Lig", "Hazırlık Maçı", "La Liga", "Serie A", "Bundesliga"]) {
    assert.equal(isSuperLigName(value), false, `"${value}" Süper Lig sayılmamalı`);
    assert.equal(displayLeagueName(value), value, `"${value}" değiştirilmemeli`);
  }
  assert.equal(displayLeagueName("", "Lig bilgisi bekleniyor"), "Lig bilgisi bekleniyor");
}

/**
 * ÜÇ UEFA TURNUVASI TEK BİÇİMDE GÖSTERİLİR.
 *
 * Veri dosyalarında kısa ad ("Konferans Ligi"), sağlayıcıda İngilizcesi
 * ("UEFA Conference League"), kürasyonda ikisi karışıktı. Okuyucu için sorun:
 * "Konferans Ligi" ile "UEFA Konferans Ligi" aynı turnuva ama iki ayrı şey
 * gibi okunuyordu.
 */
function testUefaCompetitionsAreCanonical() {
  const { isUefaCompetitionName } = require("../services/leagueIdentity.js");

  const expected = {
    "UEFA Şampiyonlar Ligi": ["Şampiyonlar Ligi", "Sampiyonlar Ligi",
      "UEFA Champions League", "Champions League", "sampiyonlar-ligi"],
    "UEFA Avrupa Ligi": ["Avrupa Ligi", "UEFA Europa League", "Europa League", "avrupa-ligi"],
    "UEFA Konferans Ligi": ["Konferans Ligi", "Avrupa Konferans Ligi",
      "UEFA Europa Conference League", "UEFA Conference League",
      "Conference League", "konferans-ligi"]
  };

  for (const [display, variants] of Object.entries(expected)) {
    // Kanonik ad kendisine eşlenmeli (idempotent).
    assert.equal(displayLeagueName(display), display, `"${display}" kendisine eşlenmeli`);
    for (const variant of variants) {
      assert.equal(displayLeagueName(variant), display,
        `"${variant}" arayüzde "${display}" olarak gösterilmeli`);
      assert.equal(isUefaCompetitionName(variant), true, `"${variant}" UEFA turnuvası sayılmalı`);
      // UEFA turnuvası Süper Lig ile karıştırılmamalı.
      assert.equal(isSuperLigName(variant), false, `"${variant}" Süper Lig sayılmamalı`);
    }
  }

  assert.equal(isUefaCompetitionName("Premier League"), false);
  assert.equal(isUefaCompetitionName(""), false);
}

/** İstemci aynı turnuva adlarını basmalı. */
function testClientMirrorsUefaNames() {
  const app = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  for (const display of ["UEFA Şampiyonlar Ligi", "UEFA Avrupa Ligi", "UEFA Konferans Ligi"]) {
    assert.ok(app.includes(display), `app.js "${display}" adını taşımalı`);
  }
  assert.ok(/function uefaCompetitionName\(/.test(app), "app.js UEFA ad çözümleyicisini tanımlamalı");
}

/** Veri dosyalarındaki lig alanı doğru adı taşımalı. */
function testDataFilesUseCanonicalName() {
  const files = [
    ["teams.json", "league"],
    ["players.json", "league"],
    ["transfers.json", "league"]
  ];

  for (const [file, field] of files) {
    const full = path.join(root, "data", file);
    if (!fs.existsSync(full)) continue;
    const raw = fs.readFileSync(full, "utf8");
    const pattern = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "g");

    for (const [, value] of raw.matchAll(pattern)) {
      if (!isSuperLigName(value)) continue;
      assert.equal(
        value,
        SUPER_LIG_DISPLAY_NAME,
        `data/${file}: "${value}" yerine "${SUPER_LIG_DISPLAY_NAME}" yazılmalı`
      );
    }
  }
}

/**
 * İÇ ANAHTARLAR KORUNUR.
 *
 * Sponsor adı bir gün değişirse URL'lerin, dosya adlarının ve sağlayıcı
 * eşleşme anahtarlarının kırılmaması gerekir. Bu test onların yanlışlıkla
 * yeniden adlandırılmadığını doğrular.
 */
function testInternalKeysUnchanged() {
  const competitions = JSON.parse(fs.readFileSync(path.join(root, "data", "competitions.json"), "utf8"));
  const list = Array.isArray(competitions) ? competitions : competitions.competitions;
  const superLig = list.find((item) => item.id === "super-lig");

  assert.ok(superLig, "competitions.json içinde 'super-lig' kimliği korunmalı");
  assert.equal(superLig.id, "super-lig", "iç kimlik değişmemeli");
  assert.equal(superLig.name, SUPER_LIG_DISPLAY_NAME, "görünen ad doğru olmalı");
  assert.ok(
    (superLig.aliases || []).some((alias) => isSuperLigName(alias) && alias !== SUPER_LIG_DISPLAY_NAME),
    "eski yazım takma ad olarak korunmalı; yoksa eski sorgular çözülmez"
  );

  // Sağlayıcı önbelleği sağlayıcının kendi adını taşır; bizim adımıza
  // çevrilirse eşleşme kırılır.
  const providerCache = path.join(root, "data", "api-football-league.json");
  if (fs.existsSync(providerCache)) {
    const cache = JSON.parse(fs.readFileSync(providerCache, "utf8"));
    assert.ok(isSuperLigName(cache.leagueName), "sağlayıcı önbelleği aynı lige işaret etmeli");
  }

  // URL'ler ASCII kısa ad üzerinden kurulur ve değişmemelidir.
  for (const file of ["super-lig-fikstur.html", "super-lig-form-durumu.html", "super-lig-mac-analizleri.html"]) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} adresi korunmalı`);
  }
}

/** Yayımlanan sayfalarda yanlış ya da çıplak yazım kalmamalı. */
function testPublishedPagesUseCanonicalName() {
  const pages = [
    ...fs.readdirSync(root).filter((file) => file.endsWith(".html")).map((file) => path.join(root, file)),
    ...listGenerated("mac", 30),
    ...listGenerated("mac-raporu", 10),
    ...listGenerated("oyuncular", 30)
  ];

  assert.ok(pages.length >= 60, "ön koşul: sayfalar üretilmiş olmalı");

  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);

    for (const pattern of WRONG_LABELS) {
      assert.ok(!pattern.test(html), `${name}: yanlış lig etiketi bulundu (${pattern})`);
    }
    assert.ok(
      !BARE_LABEL.test(html),
      `${name}: "Süper Lig" yazımı "Trendyol Süper Lig" olmalı`
    );
  }
}

/** SEO başlığı ve açıklaması da aynı kurala tabidir. */
function testSeoMetadataUsesCanonicalName() {
  for (const file of fs.readdirSync(root).filter((name) => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";

    for (const [label, value] of [["başlık", title], ["açıklama", description]]) {
      assert.ok(!BARE_LABEL.test(value), `${file}: meta ${label} çıplak "Süper Lig" taşıyor — "${value}"`);
      for (const pattern of WRONG_LABELS) {
        assert.ok(!pattern.test(value), `${file}: meta ${label} yanlış etiket taşıyor (${pattern})`);
      }
    }
  }
}

/**
 * İSTEMCİ-SERVİS EŞLİĞİ.
 *
 * app.js aynı kuralı tarayıcıda uyguluyor; ayrışırsa kullanıcı sayfa
 * yüklenirken bir ad, JS çalıştıktan sonra başka bir ad görür.
 */
function testClientMirrorsService() {
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");

  const clientName = (appJs.match(/var SUPER_LIG_DISPLAY_NAME = "([^"]+)";/) || [])[1];
  assert.equal(clientName, SUPER_LIG_DISPLAY_NAME, "app.js ve servis lig adı ayrışmış");

  const block = appJs.match(/var SUPER_LIG_NAME_KEYS = \[([\s\S]*?)\]\.map\(foldLeagueName\);/);
  assert.ok(block, "app.js içinde tanınan yazım listesi bulunamadı");

  const clientVariants = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    clientVariants,
    [...SUPER_LIG_NAME_VARIANTS],
    "app.js ve servis tanınan yazım listeleri ayrışmış"
  );
}

function listGenerated(relative, limit) {
  const dir = path.join(root, relative);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .slice(0, limit)
    .map((file) => path.join(dir, file));
}

testCanonicalName();
testVariantsResolveToOneName();
testOtherLeaguesPassThrough();
testUefaCompetitionsAreCanonical();
testClientMirrorsUefaNames();
testDataFilesUseCanonicalName();
testInternalKeysUnchanged();
testPublishedPagesUseCanonicalName();
testSeoMetadataUsesCanonicalName();
testClientMirrorsService();

console.log(
  "League identity tests passed (tek doğru ad, yazım varyantları, diğer ligler korunur, " +
  "veri dosyaları, iç anahtarların korunumu, yayımlanan sayfalar, SEO metası, istemci-servis eşliği)."
);
