/**
 * ÜYELİK YÜZEYLERİ — SAYFA SÖZLEŞMESİ TESTİ.
 *
 * `test-membership-api.mjs` sunucu davranışını doğruluyor; bu test
 * SAYFALARIN üzerindeki sözleşmeyi doğruluyor ve asıl derdi şu:
 *
 *   ÜYELİK SİSTEMİ SEO'YU VE MEVCUT SİTEYİ BOZMAMALI.
 *
 * Bu yüzden testlerin çoğu bir özelliğin VAR olduğunu değil, bir
 * zararın YOK olduğunu kanıtlıyor: içerik sayfalarında giriş duvarı
 * yok, başlıkta derleme anında basılmış kullanıcı adı yok, kişisel
 * bölüm ziyaretçiye görünmüyor, canonical/robots/hreflang bozulmamış.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const catalog = require("../services/membership/catalog.js");
const config = require("../services/membership/config.js");

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

let failures = 0;
const results = [];

function check(name, fn) {
  try {
    fn();
    results.push(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`  FAIL ${name}\n       ${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* 1. SAYFALAR VAR VE DOĞRU INDEKSLENİYOR                              */
/* ------------------------------------------------------------------ */

const PAGES = [
  { file: "pro.html", indexable: true },
  { file: "en/pro.html", indexable: true },
  { file: "giris.html", indexable: false },
  { file: "en/login.html", indexable: false },
  { file: "profil.html", indexable: false },
  { file: "en/profile.html", indexable: false }
];

for (const page of PAGES) {
  check(`${page.file} üretildi`, () => assert.ok(exists(page.file)));
}

check("PRO sayfası indekslenebilir", () => {
  for (const file of ["pro.html", "en/pro.html"]) {
    assert.match(read(file), /<meta name="robots" content="index,follow/, `${file} indekslenebilir olmalı`);
  }
});

check("profil ve giris sayfalari INDEKSLENMIYOR", () => {
  // Kişiye özel, sunucudan boş gelen kabuklar. İndekslenirlerse arama
  // sonucunda hiçbir şey anlatmayan iki sayfa çıkar.
  for (const file of ["giris.html", "en/login.html", "profil.html", "en/profile.html"]) {
    assert.match(read(file), /<meta name="robots" content="noindex,follow"/, `${file} noindex olmalı`);
  }
});

check("her uyelik sayfasinin canonical'i var", () => {
  for (const page of PAGES) {
    assert.match(read(page.file), /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\//, page.file);
  }
});

check("PRO sayfasi TR/EN karsilikli dil kutusu tasiyor", () => {
  assert.match(read("pro.html"), /data-lang-switch="en"[\s\S]*?/, "TR sayfada EN kutusu yok");
  assert.match(read("en/pro.html"), /data-lang-switch="tr"/, "EN sayfada TR kutusu yok");
});

/* ------------------------------------------------------------------ */
/* 2. PRO SAYFASI FİYATI SABİT YAZMIYOR                                */
/* ------------------------------------------------------------------ */

check("PRO sayfasi 'ucretsiz' diyor ve fiyat config'ten geliyor", () => {
  const html = read("pro.html");
  assert.ok(html.includes("PRO şu anda tüm FutbolRadar kullanıcılarına ücretsiz."), "ücretsiz bandı yok");
  assert.ok(html.includes("Erken erişim döneminde ücretsiz"), "erken erişim notu yok");
  assert.ok(html.includes(config.priceLabel("tr")), "fiyat etiketi config ile uyuşmuyor");
});

check("PRO sayfasi urun semasi tasiyor ve fiyat 0", () => {
  const html = read("pro.html");
  const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(match, "ld+json yok");
  const schema = JSON.parse(match[1]);
  assert.equal(schema["@type"], "Product");
  assert.equal(schema.offers.price, String(config.PRO_PRICE));
});

check("hicbir yerde odeme/kart istenmiyor", () => {
  // Bu testin tek işi: bir gün biri "kart bilgisi" formunu sayfaya
  // koyarsa derlemenin kırmızıya dönmesi.
  const forbidden = /kart numaras|card number|cvv|iyzico|stripe\.com|checkout\.session/i;
  for (const page of PAGES) {
    assert.doesNotMatch(read(page.file), forbidden, `${page.file} ödeme alanı içeriyor`);
  }
});

/* ------------------------------------------------------------------ */
/* 3. BAŞLIK: SUNUCU ÇIKTISI HER ZAMAN "GİRİŞ YAPILMAMIŞ"              */
/* ------------------------------------------------------------------ */

const SAMPLE_PAGES = [
  "index.html",
  "en/index.html",
  "canli-skor.html",
  "puan-durumu.html",
  "haberler.html",
  "takimlar.html",
  "futbolcu/mauro-icardi.html",
  "pro.html"
].filter(exists);

check("ornek sayfa kumesi bos degil", () => assert.ok(SAMPLE_PAGES.length >= 6));

check("basligta hesap blogu var", () => {
  for (const file of SAMPLE_PAGES) {
    assert.match(read(file), /data-account-nav/, `${file}: hesap bloğu yok`);
  }
});

check("basligin sunucu hali ANONIM", () => {
  // CDN'de paylaşılan bir sayfaya derleme anında kullanıcı adı basmak,
  // o adı sayfayı açan herkese göstermek olurdu.
  for (const file of SAMPLE_PAGES) {
    const html = read(file);
    assert.match(html, /data-account-state="anonymous"/, `${file}: varsayılan durum anonim değil`);
    assert.match(html, /data-account-user hidden/, `${file}: kullanıcı bloğu gizli değil`);
    assert.match(html, /data-account-bell[^>]*hidden/, `${file}: zil gizli değil`);
  }
});

check("giris baglantisi dogru dile gidiyor", () => {
  // Türkçe sayfa `/giris`e, İngilizce sayfa `/en/login`e gitmeli:
  // İngilizce okuyucuyu Türkçe bir forma düşürmek, dil ayrımını
  // üyelik akışında kaybetmek olurdu. Adres köke göre GÖRELİ
  // (`en/index.html` için "../"), bu yüzden yalnızca sonu aranıyor.
  assert.match(read("index.html"), /class="account-signin" href="\.\/giris\.html"/);
  assert.match(read("en/index.html"), /class="account-signin" href="\.\.\/en\/login\.html"/);
});

check("uyelik betigi her sayfada", () => {
  for (const file of SAMPLE_PAGES) {
    assert.match(read(file), /<script defer src="\/membership\.js(\?[^"]*)?"><\/script>/, `${file}: membership.js yok`);
  }
});

check("uyelik betigi ERTELENMIS yukleniyor", () => {
  // `defer` olmadan betik ayrıştırmayı bloklar ve Core Web Vitals'ı
  // doğrudan kötüleştirir.
  assert.match(read("index.html"), /<script defer src="\/membership\.js/);
});

/* ------------------------------------------------------------------ */
/* 4. İÇERİK SAYFALARINDA GİRİŞ DUVARI YOK                             */
/* ------------------------------------------------------------------ */

const SEO_PAGES = [
  "index.html",
  "canli-skor.html",
  "puan-durumu.html",
  "haberler.html",
  "takimlar.html",
  "gol-kralligi.html",
  "transfer-radari.html",
  "futbolcu/mauro-icardi.html",
  "super-lig-puan-durumu.html",
  "en/index.html",
  "en/standings.html"
].filter(exists);

check("SEO sayfalarinda giris duvari yok", () => {
  for (const file of SEO_PAGES) {
    const html = read(file);
    // Bir içerik sayfası, giriş kapısı işaretlemesi taşımamalı.
    assert.doesNotMatch(html, /data-profile-signin/, `${file}: giriş kapısı var`);
    assert.doesNotMatch(html, /data-auth-form/, `${file}: giriş formu var`);
  }
});

check("SEO sayfalari indekslenebilir kalmis", () => {
  for (const file of SEO_PAGES) {
    assert.match(read(file), /<meta name="robots" content="index,follow/, `${file}: indekslenebilir değil`);
  }
});

check("SEO sayfalarinin ana icerigi hala sunucudan geliyor", () => {
  // Üyelik katmanı hiçbir içeriği istemciye taşımamalı. Ölçüt kaba
  // ama etkili: sayfanın gövdesi hâlâ dolu mu?
  for (const file of SEO_PAGES) {
    const html = read(file);
    const main = html.match(/<main[\s\S]*?<\/main>/);
    assert.ok(main, `${file}: <main> yok`);
    assert.ok(main[0].length > 2000, `${file}: ana içerik çok küçük (${main[0].length})`);
  }
});

check("uyelik acilir pencere/interstitial ENJEKTE ETMIYOR", () => {
  // "Siteyi ziyaret eden kullanıcıya sürekli üyelik popup'ı gösterme."
  const client = read("membership.js");
  assert.doesNotMatch(client, /showModal\(|<dialog|interstitial|popup/i, "istemci betiği popup açıyor");
});

/* ------------------------------------------------------------------ */
/* 5. KİŞİSEL ANA SAYFA                                                */
/* ------------------------------------------------------------------ */

check("Senin Icin blogu iki ana sayfada da var", () => {
  assert.match(read("index.html"), /data-personal-home/);
  assert.match(read("en/index.html"), /data-personal-home/);
});

check("Senin Icin blogu ZIYARETCIYE GIZLI ve BOS", () => {
  for (const file of ["index.html", "en/index.html"]) {
    const html = read(file);
    const block = html.match(/<section[^>]*data-personal-home[^>]*>[\s\S]*?<\/section>/);
    assert.ok(block, `${file}: blok yok`);
    assert.match(block[0], /data-personal-home hidden/, `${file}: blok gizli değil`);
    assert.match(block[0], /<ul class="personal-list" data-personal-list><\/ul>/, `${file}: liste boş değil`);
  }
});

check("Senin Icin blogu iki dilde dogru basligi tasiyor", () => {
  assert.ok(read("index.html").includes("Senin İçin"));
  assert.ok(read("en/index.html").includes("For You"));
});

/* ------------------------------------------------------------------ */
/* 6. FAVORİ DÜĞMELERİ — KİMLİKLER KÜTÜKTE GERÇEKTEN VAR MI?           */
/* ------------------------------------------------------------------ */

function collectFavoriteButtons(files) {
  const found = [];
  for (const file of files) {
    const html = read(file);
    const pattern = /data-favorite-kind="([^"]+)" data-favorite-id="([^"]+)"/g;
    let match;
    while ((match = pattern.exec(html)) !== null) {
      found.push({ file, kind: match[1], id: match[2] });
    }
  }
  return found;
}

const BUTTON_PAGES = [
  "takimlar/galatasaray.html",
  "takimlar/fenerbahce.html",
  "futbolcu/mauro-icardi.html",
  "la-liga-puan-durumu.html",
  "super-lig-puan-durumu.html",
  "en/la-liga-standings.html"
].filter(exists);

const buttons = collectFavoriteButtons(BUTTON_PAGES);

check("favori dugmeleri sayfalara basildi", () => {
  assert.ok(buttons.length >= BUTTON_PAGES.length, `beklenen ≥${BUTTON_PAGES.length}, bulunan ${buttons.length}`);
  assert.ok(buttons.some((button) => button.kind === "team"), "takım düğmesi yok");
  assert.ok(buttons.some((button) => button.kind === "player"), "oyuncu düğmesi yok");
  assert.ok(buttons.some((button) => button.kind === "league"), "lig düğmesi yok");
});

check("HER favori dugmesinin kimligi kutukte cozuluyor", () => {
  // Çözülmeyen bir kimlik, tıklandığında sunucunun reddedeceği bir
  // düğme demek: kullanıcı tıklar, hiçbir şey olmaz, hata da görmez.
  for (const button of buttons) {
    const resolved = catalog.resolveFavorite(button.kind, button.id);
    assert.ok(resolved, `${button.file}: ${button.kind}/${button.id} kütükte yok`);
  }
});

check("favori dugmesi varsayilan olarak TAKIP EDILMIYOR", () => {
  for (const file of BUTTON_PAGES) {
    const html = read(file);
    const matches = html.match(/<button class="favorite-button"[^>]*>/g) || [];
    for (const markup of matches) {
      assert.match(markup, /aria-pressed="false"/, `${file}: düğme takipte başlıyor`);
      assert.doesNotMatch(markup, /is-following/, `${file}: düğme takipte başlıyor`);
    }
  }
});

check("favori dugmesi erisim etiketi tasiyor", () => {
  for (const file of BUTTON_PAGES) {
    for (const markup of read(file).match(/<button class="favorite-button"[^>]*>/g) || []) {
      assert.match(markup, /aria-label="[^"]+"/, `${file}: aria-label yok`);
    }
  }
});

/* ------------------------------------------------------------------ */
/* 7. AI ANALİZİ                                                       */
/* ------------------------------------------------------------------ */

const matchPages = fs.existsSync(path.join(root, "mac"))
  ? fs.readdirSync(path.join(root, "mac")).filter((file) => file.endsWith(".html")).map((file) => `mac/${file}`)
  : [];

const aiPages = matchPages.filter((file) => read(file).includes("data-ai-analysis"));

check("AI analiz bolumu mac sayfalarinda var", () => {
  assert.ok(aiPages.length > 0, "hiçbir maç sayfasında AI analizi yok");
});

check("AI analizi FutbolRadar AI Analizi basligini tasiyor", () => {
  assert.ok(read(aiPages[0]).includes("FutbolRadar AI Analizi"));
});

check("AI analizi olasiliklari gosteriyor", () => {
  const html = read(aiPages[0]);
  assert.match(html, /msp-prediction-row/, "olasılık satırları yok");
  assert.match(html, /data-outcome="home"/, "ev sahibi olasılığı yok");
  assert.match(html, /data-outcome="draw"/, "beraberlik olasılığı yok");
  assert.match(html, /data-outcome="away"/, "deplasman olasılığı yok");
});

check("AI analizinin HER kopyasinda cekince VAR", () => {
  // Tahmin gösteren bir yüzeyde çekincenin eksik kalması, bu testin
  // var olma sebebi. Tek sayfada değil, HEPSİNDE aranıyor.
  for (const file of aiPages) {
    const html = read(file);
    assert.match(html, /ai-disclaimer/, `${file}: çekince sınıfı yok`);
    assert.ok(
      /kesin sonuç|certain outcome/i.test(html),
      `${file}: çekince metni yok`
    );
  }
});

check("AI analizi dayanak listesini uyduruyor DEGIL", () => {
  // Liste yalnızca sayfada gerçekten bulunan bölümlerden üretilmeli.
  // H2H satırı varsa sayfada H2H bölümü de olmalı.
  for (const file of aiPages.slice(0, 40)) {
    const html = read(file);
    const basis = html.match(/<ul class="ai-basis">([\s\S]*?)<\/ul>/);
    if (!basis) continue;
    if (basis[1].includes("İkili rekabet")) {
      assert.match(html, /msp-h2h-title|id="h2h"/, `${file}: H2H iddiası var ama bölüm yok`);
    }
    if (basis[1].includes("Lig sıralaması")) {
      assert.match(html, /msp-standings-title/, `${file}: sıralama iddiası var ama tablo yok`);
    }
  }
});

check("mac sayfasinda maci takip et dugmesi var ve cozuluyor", () => {
  const withFollow = matchPages.filter((file) => read(file).includes('data-favorite-kind="match"'));
  assert.ok(withFollow.length > 100, `beklenenden az maç sayfasında düğme var: ${withFollow.length}`);
  for (const file of withFollow.slice(0, 25)) {
    const id = read(file).match(/data-favorite-kind="match" data-favorite-id="([^"]+)"/)[1];
    assert.ok(catalog.resolveFavorite("match", id), `${file}: ${id} kütükte yok`);
  }
});

/* ------------------------------------------------------------------ */
/* 8. ANALYTICS                                                        */
/* ------------------------------------------------------------------ */

check("istenen tum analytics olaylari istemcide tanimli", () => {
  const client = read("membership.js");
  const required = [
    "signup_started", "signup_completed", "login_completed", "pro_page_view",
    "favorite_team_added", "favorite_player_added", "favorite_match_added",
    "notification_enabled", "ai_analysis_view"
  ];
  for (const event of required) {
    assert.ok(client.includes(`"${event}"`), `${event} olayı yok`);
  }
});

check("analytics gtag yoksa sessizce geciliyor", () => {
  // Ölçüm, özelliğin çalışmasına engel olamaz.
  assert.match(read("membership.js"), /typeof window\.gtag === "function"/);
});

/* ------------------------------------------------------------------ */
/* 9. MOBİL                                                            */
/* ------------------------------------------------------------------ */

const css = read("page.css");

check("mobilde hesap blogu daraltiliyor", () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.account-name \{ display: none; \}/);
});

check("375px altinda tasma yaratacak sabit genislik yok", () => {
  // Üyelik yüzeylerinde ekran genişliğinden büyük bir `min-width` ya da
  // sabit `width`, 375px'te yatay kaydırma demek.
  const section = css.slice(css.indexOf("FUTBOLRADAR PRO — ÜYELİK YÜZEYLERİ"));
  const widths = section.match(/(?:^|[\s;{])(?:min-)?width:\s*(\d+)px/g) || [];
  for (const declaration of widths) {
    const pixels = Number(declaration.match(/(\d+)px/)[1]);
    assert.ok(pixels <= 340, `üyelik CSS'inde ${pixels}px sabit genişlik var`);
  }
});

check("acilir paneller ekran genisligine sigiyor", () => {
  assert.match(css, /\.account-notifications \{[\s\S]*?width: min\(320px, calc\(100vw - 32px\)\)/);
});

check("form girdileri iOS yakinlastirmasini tetiklemiyor", () => {
  // 16px altı yazı tipi, iOS Safari'de odaklanınca sayfayı yakınlaştırır.
  assert.match(css, /\.auth-field input \{[\s\S]*?font-size: 16px;/);
});

/* ------------------------------------------------------------------ */
/* 10. İKİ DİLLİLİK                                                    */
/* ------------------------------------------------------------------ */

const tr = JSON.parse(read("locales/tr.json"));
const en = JSON.parse(read("locales/en.json"));

check("uyelik sozluk anahtarlari iki dilde de tam", () => {
  const prefixes = ["account.", "auth.", "pro.", "profile.", "favorite.", "notify.", "personal.", "ai.", "tab."];
  const keys = Object.keys(tr).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
  assert.ok(keys.length > 100, `üyelik anahtarı az: ${keys.length}`);
  for (const key of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `EN sözlükte eksik: ${key}`);
    assert.ok(String(en[key]).trim(), `EN karşılığı boş: ${key}`);
  }
});

check("EN sozlukte Turkce karakter kalmamis", () => {
  const prefixes = ["account.", "auth.", "pro.", "profile.", "favorite.", "notify.", "personal.", "ai."];
  for (const key of Object.keys(en).filter((item) => prefixes.some((prefix) => item.startsWith(prefix)))) {
    // "Süper Lig" gibi özel adlar hariç: onlar çevrilmez.
    if (/Süper|Şampiyonlar/.test(en[key])) continue;
    assert.doesNotMatch(String(en[key]), /[çğışöüÇĞİŞÖÜ]/, `EN karşılığı Türkçe: ${key} = ${en[key]}`);
  }
});

check("TR ve EN ayni hesabi kullaniyor", () => {
  // Oturum çerezi köke yazılıyor (Path=/), yani /en/ altında da geçerli.
  assert.match(read("services/membership/session.js"), /"Path=\/"/);
});

console.log("ÜYELİK YÜZEYLERİ TESTİ");
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} gecti`);

if (failures) {
  console.error(`\n${failures} test BASARISIZ`);
  process.exit(1);
}
