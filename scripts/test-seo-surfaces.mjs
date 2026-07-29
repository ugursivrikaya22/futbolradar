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

/** Arama sonucunda kesilmeyen başlık sınırı. */
const TITLE_BUDGET = 65;
const DESCRIPTION_MIN = 60;
const DESCRIPTION_MAX = 160;

function testHomepageIdentity() {
  const html = read("index.html");
  assert.equal(
    pick(html, /<title>([^<]*)<\/title>/),
    HOMEPAGE_TITLE,
    "ana sayfa başlığı sözleşmeye uymuyor"
  );

  const description = pick(html, /<meta name="description" content="([^"]*)"/);
  assert.ok(description.length >= DESCRIPTION_MIN, "ana sayfa açıklaması fazla kısa");
  assert.ok(
    description.length <= DESCRIPTION_MAX,
    `ana sayfa açıklaması arama sonucunda kesilir (${description.length} karakter)`
  );
  for (const keyword of ["canlı skor", "bugünün maçları", "takım formu"]) {
    assert.ok(
      description.toLocaleLowerCase("tr").includes(keyword),
      `ana sayfa açıklamasında "${keyword}" geçmeli`
    );
  }
}

/**
 * ANA SAYFA H1'İ ANAHTAR KELİME TAŞIMALI.
 *
 * H1 "Canlı skor.Maç merkezi." idi: "maç merkezi" aranan bir ifade değil ve
 * iki `<span>` arasında boşluk olmadığı için tarayıcı metni bitişik okuyordu.
 */
function testHomepageHeading() {
  const html = read("index.html");
  const h1 = pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  assert.ok(h1, "ana sayfada H1 yok");
  assert.ok(!/\w\.\w/.test(h1), `H1 metni bitişik okunuyor: "${h1}"`);

  const folded = h1.toLocaleLowerCase("tr");
  assert.ok(
    ["canlı skor", "bugünün maçları"].some((keyword) => folded.includes(keyword)),
    `H1 hedef sorguyu taşımıyor: "${h1}"`
  );
}

/**
 * ANA SAYFA YAPILANDIRILMIŞ VERİSİ.
 *
 * WebSite ve Organization her zaman; bugünün maçları listesi ise YALNIZCA
 * gerçek kayıt varsa. Boş bir ItemList yayımlamak "bugün maç yok" iddiasını
 * arama motoruna yazmak olurdu ve o iddia verimizin değil, senkron
 * zamanlamamızın sonucu olabilir.
 */
function testHomepageStructuredData() {
  const html = read("index.html");
  const raw = pick(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);

  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(raw); }, "ana sayfa yapılandırılmış verisi geçersiz JSON");

  const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
  const types = graph.map((node) => node["@type"]);

  assert.ok(types.includes("WebSite"), "WebSite düğümü yok");
  assert.ok(types.includes("Organization"), "Organization düğümü yok");

  const organization = graph.find((node) => node["@type"] === "Organization");
  assert.ok(organization.logo, "Organization logosu yok");
  assert.ok(Array.isArray(organization.sameAs) && organization.sameAs.length, "Organization sameAs yok");

  const list = graph.find((node) => node["@type"] === "ItemList");
  if (!list) return; // Bugün doğrulanmış maç yok: düğüm üretilmemesi doğru.

  assert.ok(list.itemListElement.length, "boş ItemList yayımlanmamalı");
  assert.equal(list.numberOfItems, list.itemListElement.length, "ItemList sayacı listeyle uyuşmuyor");

  for (const entry of list.itemListElement) {
    const event = entry.item;
    assert.equal(event["@type"], "SportsEvent", "liste öğesi SportsEvent olmalı");
    assert.ok(event.name && event.name.includes("-"), "maç adı iki takımı taşımalı");
    assert.ok(event.startDate, `"${event.name}": başlama saati olmayan maç olay olarak yayımlanmamalı`);
    assert.ok(!Number.isNaN(Date.parse(event.startDate)), `"${event.name}": başlama saati okunamıyor`);
    assert.ok(event.homeTeam && event.awayTeam, `"${event.name}": takım düğümleri eksik`);
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
 * MAÇ DETAY SAYFALARI — başlık/açıklama/H1 ve yapılandırılmış veri.
 *
 * Örnekleme değil, TAMAMI denetlenir: 306 maç önü sayfası tek bir şablondan
 * üretiliyor ve şablon bozulduğunda hepsi birden bozulur.
 *
 * Yapılandırılmış veride tek kural: EKSİK OLAY YAYIMLANMAZ. Arama motoru
 * Event için `startDate` zorunlu sayıyor; fikstürde saat yoksa sayfa
 * `SportsEvent` değil `WebPage` bildirir. Uydurma tarih yazmak, 306 URL'de
 * "eksik alan" hatası üretmekten de kötüdür.
 */
function testMatchPagesCarryDynamicSeo() {
  const samples = [...listHtml("mac"), ...listHtml("mac-raporu")];
  assert.ok(samples.length >= 100, "ön koşul: maç sayfaları üretilmiş olmalı");

  const titles = new Set();
  const descriptions = new Set();

  for (const file of samples) {
    const html = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);
    const title = pick(html, /<title>([^<]*)<\/title>/);
    const description = pick(html, /<meta name="description" content="([^"]*)"/);
    const h1 = pick(html, /<h1[^>]*>([^<]*)<\/h1>/);

    assert.ok(title.trim(), `${name}: başlık yok`);
    assert.ok(
      title.length <= TITLE_BUDGET,
      `${name}: başlık arama sonucunda kesilir (${title.length} karakter) — "${title}"`
    );
    assert.ok(!titles.has(title), `${name}: başlık başka bir maç sayfasıyla aynı`);
    titles.add(title);

    assert.ok(
      description.length >= DESCRIPTION_MIN && description.length <= DESCRIPTION_MAX,
      `${name}: meta açıklama uzunluğu uygunsuz (${description.length})`
    );
    assert.ok(!descriptions.has(description), `${name}: açıklama başka bir maç sayfasıyla aynı`);
    descriptions.add(description);

    assert.ok(h1.includes("-"), `${name}: H1 iki takımı da içermeli — "${h1}"`);
    assert.ok(html.includes('<html lang="tr">'), `${name}: dil etiketi Türkçe olmalı`);

    const schema = pick(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(schema); }, `${name}: yapılandırılmış veri geçersiz JSON`);

    const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    const event = graph.find((node) => node && node["@type"] === "SportsEvent");
    const page = graph.find((node) => node && node["@type"] === "WebPage");

    assert.ok(event || page, `${name}: ne SportsEvent ne WebPage düğümü var`);

    if (event) {
      assert.ok(event.name && event.name.includes("-"), `${name}: SportsEvent adı eksik`);
      assert.ok(
        event.startDate,
        `${name}: başlama saati olmayan SportsEvent yayımlanmamalı — WebPage bildirilmeli`
      );
      assert.ok(!Number.isNaN(Date.parse(event.startDate)), `${name}: startDate okunamıyor`);
      assert.ok(event.homeTeam && event.awayTeam, `${name}: SportsEvent takım düğümleri eksik`);
    }

    // Breadcrumb işaretlemesi görünür yolla aynı olmalı; ayrışırsa arama
    // motoru işaretlemeyi yok sayar.
    const crumbs = graph.find((node) => node && node["@type"] === "BreadcrumbList");
    assert.ok(crumbs, `${name}: BreadcrumbList yok`);
    for (const item of crumbs.itemListElement) {
      assert.ok(item.name && item.item, `${name}: breadcrumb öğesi eksik`);
      if (item.position === 2) {
        assert.ok(
          html.includes(`>${item.name}</a>`),
          `${name}: breadcrumb işaretlemesi görünür yolla uyuşmuyor ("${item.name}")`
        );
      }
    }
  }
}

/** Maç raporlarında Article düğümü kaynağını ve yazarını bildirmeli. */
function testMatchReportArticleNode() {
  for (const file of listHtml("mac-raporu")) {
    const html = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);
    const parsed = JSON.parse(pick(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
    const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    const article = graph.find((node) => node && node["@type"] === "Article");

    assert.ok(article, `${name}: Article düğümü yok`);
    for (const field of ["headline", "description", "datePublished", "author", "image", "publisher", "inLanguage"]) {
      assert.ok(article[field], `${name}: Article.${field} eksik`);
    }
    assert.ok(!Number.isNaN(Date.parse(article.datePublished)), `${name}: datePublished okunamıyor`);
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


/**
 * BAŞLIK VE AÇIKLAMA BÜTÇESİ — TÜM YAYIMLANAN SAYFALAR.
 *
 * Denetimde 3404 sayfanın 1276'sında başlık 65 karakteri aşıyordu; arama
 * sonucunda lig adı ve marka hiç görünmüyor, okuyucu yarım bir cümle
 * okuyordu. Kural artık sayfa başına değil, SİTE genelinde geçerli.
 */
function testEveryPageFitsSeoBudget() {
  const pages = collectAll();
  assert.ok(pages.length >= 100, "ön koşul: sayfalar üretilmiş olmalı");

  const longTitles = [];
  const shortDescriptions = [];

  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    if (/content="noindex/.test(html)) continue;
    const name = path.relative(root, file);
    const title = pick(html, /<title>([^<]*)<\/title>/);
    const description = pick(html, /<meta name="description" content="([^"]*)"/);

    if (title.length > TITLE_BUDGET) longTitles.push(`${name} (${title.length})`);
    if (description && description.length < DESCRIPTION_MIN) {
      shortDescriptions.push(`${name} (${description.length})`);
    }
  }

  assert.equal(
    longTitles.length, 0,
    `başlık bütçesini aşan sayfa: ${longTitles.slice(0, 5).join(", ")}${longTitles.length > 5 ? ` … +${longTitles.length - 5}` : ""}`
  );
  assert.equal(
    shortDescriptions.length, 0,
    `açıklaması fazla kısa sayfa: ${shortDescriptions.slice(0, 5).join(", ")}${shortDescriptions.length > 5 ? ` … +${shortDescriptions.length - 5}` : ""}`
  );
}

/**
 * ÖKSÜZ SAYFA OLMAMALI.
 *
 * "En iyi defanslar" ve "Trendyol Süper Lig oyuncu radarı" hiçbir sayfadan
 * bağlantı almıyordu; yalnızca site haritası üzerinden taranabiliyorlardı.
 * Bir sayfa yayımlanacaksa siteden erişilebilir de olmalı.
 */
function testNoOrphanRootPages() {
  const linked = new Set();
  for (const file of collectAll()) {
    const dir = path.dirname(file);
    const html = fs.readFileSync(file, "utf8");
    for (const [, href] of html.matchAll(/<a\b[^>]*href="([^"#?]+)(?:[#?][^"]*)?"/g)) {
      if (/^(https?:|mailto:|tel:)/i.test(href) || !href) continue;
      linked.add(path.relative(root, path.resolve(dir, href)));
    }
  }

  const orphans = fs.readdirSync(root)
    .filter((file) => file.endsWith(".html"))
    .filter((file) => !EXEMPT.has(file) && file !== "index.html")
    .filter((file) => !/content="noindex/.test(read(file)))
    .filter((file) => !linked.has(file));

  assert.equal(orphans.length, 0, `hiçbir sayfadan bağlantı almayan sayfa: ${orphans.join(", ")}`);
}

/**
 * ANCHOR METNİ HEDEFİNİ SÖYLEMELİ.
 *
 * "Detay", "Tümü", "Tıkla" gibi metinler ne arama motoruna ne de ekran
 * okuyucuya nereye gidildiğini anlatır. Bant bağlantısı tek başına 3402
 * sayfada "Tümü" diyordu.
 */
const VAGUE_ANCHORS = new Set([
  "detay", "detaylar", "tümü", "devamı", "buraya tıkla", "tıkla", "aç", "git", "daha fazla", "oku"
]);

function testAnchorsAreDescriptive() {
  const offenders = [];
  for (const file of collectAll().slice(0, 400)) {
    const html = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);
    for (const [, inner] of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");
      if (VAGUE_ANCHORS.has(label)) offenders.push(`${name}: "${label}"`);
    }
  }
  assert.equal(
    offenders.length, 0,
    `belirsiz bağlantı metni: ${[...new Set(offenders)].slice(0, 5).join(", ")}`
  );
}

/**
 * "%0" BİR ÖLÇÜM İDDİASIDIR.
 *
 * Radar kartı hiç bileşen ölçemediğinde bile "Kapsam %0" yazıyordu; aynı
 * kartın puan satırı ise dürüstçe "Veri bekleniyor" diyordu. Ölçüm yoksa
 * hiçbir rakam basılmamalı.
 */
function testNoZeroMeasurementClaims() {
  const offenders = [];
  for (const file of collectAll()) {
    const html = fs.readFileSync(file, "utf8");
    const name = path.relative(root, file);
    if (/Kapsam %0\b/.test(html)) offenders.push(`${name}: Kapsam %0`);
    if (/Veri güveni %0\b/.test(html)) offenders.push(`${name}: Veri güveni %0`);
  }
  assert.equal(
    offenders.length, 0,
    `ölçüm yokken sıfır rakamı basan sayfa: ${offenders.slice(0, 5).join(", ")}`
  );
}

function collectAll(dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "public") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectAll(full, out);
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

testHomepageIdentity();
testHomepageHeading();
testHomepageStructuredData();
testEveryPageHasCoreTags();
testCanonicalPointsAtItself();
testTitlesAndDescriptionsAreUnique();
testIntentPagesExist();
testHomepageLinksToIntentPages();
testSitemapIntegrity();
testRobotsTxt();
testMatchPagesCarryDynamicSeo();
testMatchReportArticleNode();
testEveryPageFitsSeoBudget();
testNoOrphanRootPages();
testAnchorsAreDescriptive();
testNoZeroMeasurementClaims();

console.log(
  "SEO surface tests passed (ana sayfa kimliği + H1 + yapılandırılmış veri, temel etiketler, " +
  "canonical doğruluğu, benzersizlik, arama niyeti sayfaları, iç bağlantı, site haritası bütünlüğü, " +
  "robots, maç detay başlık bütçesi, site geneli başlık/açıklama bütçesi, öksüz sayfa yasağı, " +
  "açıklayıcı bağlantı metni ve sıfır-ölçüm koruması)."
);
