/**
 * SEO YÜZEYLERİ TESTLERİ
 *
 * Sitenin arama görünürlüğü, elle düzenlenen HTML ile üretici scriptler
 * arasında paylaşılıyor. Bir üretici bozulduğunda ya da bir sayfa elle
 * eklendiğinde ortaya çıkan hatalar sessizdir: sayfa yayımlanır, yalnızca
 * indekslenmez. Bu test o sessizliği kırar.
 *
 * Sözleşme:
 *   1. Her yayımlanan sayfada başlık, açıklama, canonical ve TEK bir H1 olur.
 *   2. Canonical, sayfanın gerçek adresini gösterir; başka sayfayı işaret
 *      eden canonical o sayfayı indeksten düşürür.
 *   3. Başlık ve açıklama sayfalar arasında benzersizdir.
 *   4. Kullanıcıya görünen metin Türkçedir: `<html lang="tr">`.
 *   5. Arama niyeti sayfaları (bugünün maçları, canlı skor, günlük maç
 *      analizleri, Süper Lig maç analizleri, takım formu) yayımlanmış,
 *      site haritasında ve ana sayfadan bağlantılı olur.
 *   6. Site haritası yinelenen adres taşımaz ve noindex sayfa listelemez.
 *   7. Maç sayfaları geçerli SportsEvent yapılandırılmış verisi taşır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";

/** Arama sonucu üretmeyen, bilinçli olarak şablon dışı bırakılmış dosyalar. */
const EXEMPT = new Set([
  "googlef881b0d7527a8fba.html", // Google doğrulama dosyası: içeriği tek satır.
  "404.html"                     // Hata sayfası indekslenmez.
]);

/** Arama niyeti sayfaları: hedeflenen sorguların giriş noktaları. */
const INTENT_PAGES = [
  ["bugunun-maclari.html", "Bugünün Maçları"],
  ["canli-skor.html", "Canlı Skor"],
  ["gunluk-mac-analizleri.html", "Günlük Maç Analizleri"],
  ["super-lig-mac-analizleri.html", "Süper Lig Maç Analizleri"],
  ["galatasaray-form-durumu.html", "Galatasaray Form Durumu"],
  ["fenerbahce-form-durumu.html", "Fenerbahçe Form Durumu"],
  ["besiktas-form-durumu.html", "Beşiktaş Form Durumu"],
  ["trabzonspor-form-durumu.html", "Trabzonspor Form Durumu"],
  ["super-lig-form-durumu.html", "Süper Lig Form Durumu"]
];

const HOMEPAGE_TITLE = "FutbolRadar | Canlı Skor, Bugünün Maçları ve Takım Formu.";

function rootPages() {
  return fs.readdirSync(root)
    .filter((file) => file.endsWith(".html"))
    .filter((file) => !EXEMPT.has(file))
    .sort();
}

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const pick = (html, expression) => (html.match(expression) || [])[1] || "";

function testHomepageIdentity() {
  const html = read("index.html");
  assert.equal(
    pick(html, /<title>([^<]*)<\/title>/),
    HOMEPAGE_TITLE,
    "ana sayfa başlığı sözleşmeye uymuyor"
  );

  const description = pick(html, /<meta name="description" content="([^"]*)"/);
  assert.ok(description.length >= 80, "ana sayfa açıklaması fazla kısa");
  assert.ok(description.length <= 320, "ana sayfa açıklaması fazla uzun");
  for (const keyword of ["canlı skor", "bugünün maçları", "takım formu"]) {
    assert.ok(
      description.toLocaleLowerCase("tr").includes(keyword),
      `ana sayfa açıklamasında "${keyword}" geçmeli`
    );
  }
}

/** Her sayfada başlık, açıklama, canonical, tek H1 ve Türkçe dil etiketi. */
function testEveryPageHasCoreTags() {
  for (const file of rootPages()) {
    const html = read(file);

    assert.ok(pick(html, /<title>([^<]*)<\/title>/).trim(), `${file}: başlık yok`);
    assert.ok(
      pick(html, /<meta name="description" content="([^"]*)"/).trim(),
      `${file}: meta açıklaması yok`
    );
    assert.ok(
      pick(html, /<link rel="canonical" href="([^"]*)"/).trim(),
      `${file}: canonical yok`
    );
    assert.ok(html.includes('<html lang="tr">'), `${file}: dil etiketi Türkçe olmalı`);

    const headings = (html.match(/<h1[\s>]/g) || []).length;
    assert.equal(headings, 1, `${file}: tam olarak bir H1 olmalı (${headings} var)`);
  }
}

/** Canonical sayfanın kendi adresini göstermeli. */
function testCanonicalPointsAtItself() {
  for (const file of rootPages()) {
    const canonical = pick(read(file), /<link rel="canonical" href="([^"]*)"/);
    const expected = file === "index.html" ? `${DOMAIN}/` : `${DOMAIN}/${file}`;
    assert.equal(canonical, expected, `${file}: canonical yanlış adresi gösteriyor`);
  }
}

/** Aynı başlık iki sayfada olursa arama motoru birini eler. */
function testTitlesAndDescriptionsAreUnique() {
  const titles = new Map();
  const descriptions = new Map();

  for (const file of rootPages()) {
    const html = read(file);
    const title = pick(html, /<title>([^<]*)<\/title>/);
    const description = pick(html, /<meta name="description" content="([^"]*)"/);

    assert.ok(!titles.has(title), `yinelenen başlık: ${file} ve ${titles.get(title)}`);
    titles.set(title, file);

    assert.ok(
      !descriptions.has(description),
      `yinelenen meta açıklaması: ${file} ve ${descriptions.get(description)}`
    );
    descriptions.set(description, file);
  }
}

/** Arama niyeti sayfaları yayımlanmış ve doğru başlıklı olmalı. */
function testIntentPagesExist() {
  for (const [file, keyword] of INTENT_PAGES) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} üretilmemiş`);
    const html = read(file);
    const title = pick(html, /<title>([^<]*)<\/title>/);
    const h1 = pick(html, /<h1[^>]*>([^<]*)<\/h1>/);

    assert.ok(title.includes(keyword), `${file}: başlıkta "${keyword}" geçmeli — "${title}"`);
    assert.ok(h1.trim(), `${file}: H1 boş`);
    assert.ok(
      html.includes('<meta name="robots" content="index,follow"'),
      `${file}: indekslenebilir olmalı`
    );
  }
}

/** Ana sayfa bu sayfaların TAMAMINA bağlanmalı; yalnız kalan sayfa taranmaz. */
function testHomepageLinksToIntentPages() {
  const html = read("index.html");
  for (const [file] of INTENT_PAGES) {
    assert.ok(
      html.includes(`href="./${file}"`),
      `ana sayfadan ${file} sayfasına bağlantı yok`
    );
  }
}

function testSitemapIntegrity() {
  const xml = read("sitemap.xml");
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

  assert.ok(locations.length > 0, "site haritası boş");
  assert.equal(
    new Set(locations).size,
    locations.length,
    "site haritasında yinelenen adres var"
  );
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "site haritası XML bildirimi eksik");

  const listed = new Set(locations);
  for (const [file] of INTENT_PAGES) {
    assert.ok(listed.has(`${DOMAIN}/${file}`), `${file} site haritasında yok`);
  }
  assert.ok(listed.has(`${DOMAIN}/`), "ana sayfa site haritasında yok");

  // noindex bir sayfayı haritaya koymak tarayıcıya çelişkili sinyal verir.
  for (const file of rootPages()) {
    if (!/content="noindex/.test(read(file))) continue;
    assert.ok(
      !listed.has(`${DOMAIN}/${file}`),
      `${file} noindex olmasına rağmen site haritasında listelenmiş`
    );
  }
}

function testRobotsTxt() {
  const robots = read("robots.txt");
  assert.ok(/User-agent:\s*\*/i.test(robots), "robots.txt genel kural taşımalı");
  assert.ok(/Allow:\s*\//i.test(robots), "robots.txt taramaya izin vermeli");
  assert.ok(
    robots.includes(`Sitemap: ${DOMAIN}/sitemap.xml`),
    "robots.txt site haritasını bildirmeli"
  );
  assert.ok(!/Disallow:\s*\/\s*$/m.test(robots), "robots.txt siteyi tamamen kapatmamalı");
}

/**
 * Maç sayfaları: dinamik başlık/açıklama/H1 ve geçerli SportsEvent verisi.
 * Yapılandırılmış veri UYDURULMAZ — yalnızca sayfada zaten yazan alanlar.
 */
function testMatchPagesCarryDynamicSeo() {
  const samples = [
    ...listHtml("mac").slice(0, 6),
    ...listHtml("mac-raporu")
  ];
  assert.ok(samples.length, "ön koşul: üretilmiş maç sayfası olmalı");

  const titles = new Set();

  for (const file of samples) {
    const html = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);
    const title = pick(html, /<title>([^<]*)<\/title>/);
    const description = pick(html, /<meta name="description" content="([^"]*)"/);
    const h1 = pick(html, /<h1[^>]*>([^<]*)<\/h1>/);

    assert.ok(title.trim(), `${name}: başlık yok`);
    assert.ok(!titles.has(title), `${name}: başlık başka bir maç sayfasıyla aynı`);
    titles.add(title);

    assert.ok(description.length >= 60, `${name}: meta açıklaması fazla kısa`);
    assert.ok(h1.includes("-"), `${name}: H1 iki takımı da içermeli — "${h1}"`);
    assert.ok(html.includes('<html lang="tr">'), `${name}: dil etiketi Türkçe olmalı`);

    const schema = pick(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(schema); }, `${name}: yapılandırılmış veri geçersiz JSON`);

    const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    const event = graph.find((node) => node && node["@type"] === "SportsEvent");
    assert.ok(event, `${name}: SportsEvent düğümü yok`);
    assert.ok(event.name && event.name.includes("-"), `${name}: SportsEvent adı eksik`);
  }
}

function listHtml(relative) {
  const dir = path.join(root, relative);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .map((file) => path.join(dir, file));
}

testHomepageIdentity();
testEveryPageHasCoreTags();
testCanonicalPointsAtItself();
testTitlesAndDescriptionsAreUnique();
testIntentPagesExist();
testHomepageLinksToIntentPages();
testSitemapIntegrity();
testRobotsTxt();
testMatchPagesCarryDynamicSeo();

console.log(
  "SEO surface tests passed (ana sayfa kimliği, temel etiketler, canonical doğruluğu, benzersizlik, " +
  "arama niyeti sayfaları, iç bağlantı, site haritası bütünlüğü, robots, dinamik maç SEO'su)."
);
