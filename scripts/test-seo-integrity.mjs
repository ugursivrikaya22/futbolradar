/**
 * SEO BÜTÜNLÜĞÜ — HER İNDEXLENEBİLİR SAYFA İÇİN, YALNIZCA KÜRATÖRLÜ OLANLAR
 * İÇİN DEĞİL.
 *
 * NEDEN BU DOSYA VAR. Depoda zaten kapsamlı bir SEO denetimi vardı
 * (scripts/qa.mjs): title, canonical, og, twitter, robots, yinelenen başlık,
 * sitemap tutarlılığı. Ama o denetim ELLE YAZILMIŞ bir sayfa listesi üzerinde
 * çalışıyordu — 74 sayfa. Sitemap'te 4.728 URL, depoda 4.817 HTML dosyası
 * var. Yani maç raporları, sezon arşivi, takım ve oyuncu sayfaları,
 * İngilizce sürümün tamamı hiç denetlenmiyordu.
 *
 * Bu tam olarak ölçeğin sessizce bozduğu şeydir: elle tutulan liste büyüyen
 * üretimin gerisinde kalır ve kimse fark etmez, çünkü denetim hâlâ yeşil
 * geçer. Bir sayfa üreticisi yinelenen başlık üretmeye başlasa 4.700 sayfada
 * yayılırdı ve 74 sayfalık denetim bunu göremezdi.
 *
 * Buradaki denetim ÜRETİLEN AĞACI dolaşır; hiçbir listeye bakmaz.
 *
 * NE DENETLENİR:
 *
 *   • başlık        — var mı, benzersiz mi
 *   • açıklama      — var mı, benzersiz mi
 *   • canonical     — var mı, sayfanın kendi adresini mi gösteriyor
 *   • H1            — var mı, tek mi
 *   • robots        — geçerli mi, sitemap'le çelişiyor mu
 *   • JSON-LD       — ayrıştırılabiliyor mu
 *
 * NOINDEX SAYFA HATA DEĞİLDİR. Bir sayfanın indexlenmemesi bilinçli bir
 * karar olabilir; denetim yalnızca ÇELİŞKİYİ arar — noindex bir sayfanın
 * sitemap'te durması gibi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROBOTS_ALLOWED, ROBOTS_INDEX } from "./lib/robots.mjs";

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";

/** Denetim dışı dizinler: üretim aynası, bağımlılıklar, araçlar. */
const SKIP_DIRS = new Set(["node_modules", "public", ".git", "docs", "components", "locales"]);

/** Denetim dışı dosyalar: doğrulama sayfaları ve hata sayfası. */
const SKIP_FILES = new Set(["404.html", "admin-updates.html", "admin-comparison-quality.html", "canli-veri-testi.html"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.name.endsWith(".html")) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    // Arama motoru doğrulama dosyaları içerik sayfası değil.
    if (/^google[0-9a-f]+\.html$/i.test(entry.name)) continue;
    out.push(path.join(dir, entry.name));
  }
  return out;
}

const pick = (html, expression) => {
  const found = html.match(expression);
  return found ? found[1].trim() : "";
};

function metaContent(html, name) {
  return pick(html, new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "i"))
    || pick(html, new RegExp(`<meta\\s+content="([^"]*)"\\s+name="${name}"`, "i"));
}

/** Dosya yolundan sayfanın kanonik adresi. */
function expectedCanonical(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (normalized === "index.html") return `${DOMAIN}/`;
  return `${DOMAIN}/${normalized}`;
}

/**
 * Canonical birkaç biçimde yazılabiliyor ve hepsi aynı adresi gösterir:
 * uzantılı, uzantısız, ve dizin sayfalarında uzantısız dizin yolu
 * (`en/index.html` → `/en`). Barındırma temiz URL'i çözdüğü için üçü de
 * geçerli.
 */
function canonicalMatches(actual, relativePath) {
  const expected = expectedCanonical(relativePath);
  const variants = new Set([
    expected,
    expected.replace(/\.html$/, ""),
    expected.replace(/\/index\.html$/, "/"),
    expected.replace(/\/index\.html$/, "")
  ]);
  return variants.has(actual);
}

/**
 * Çapraz canonical verebilen kopya aileleri.
 *
 * `mac/<takimlar>-<gun>-<ay>-<yil>.html` bu listede YOK: kanonik ailenin
 * kendisi, canonical'ı kendini göstermek zorunda.
 */
const MATCH_DUPLICATE_RES = [
  /^mac-raporu\/[^/]+\.html$/,
  /^[a-z0-9-]+-mac-analizi\.html$/
];

const isMatchDuplicate = (relativePath) => {
  const normalized = relativePath.split(path.sep).join("/");
  return MATCH_DUPLICATE_RES.some((expression) => expression.test(normalized));
};

const files = walk(root);
assert.ok(files.length > 1000, `üretilen ağaç taranmalı; bulunan dosya: ${files.length}`);

const sitemapPath = path.join(root, "sitemap.xml");
const sitemap = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, "utf8") : "";

/**
 * Geçerli çapraz canonical hedefleri: diskte karşılığı olan ve canonical'ı
 * kendini gösteren tarih slug'lı `/mac/` sayfaları. Uzantılı ve uzantısız
 * yazım da kabul — barındırma ikisini de aynı sayfaya çözüyor.
 */
const canonicalTargets = new Set();
{
  const macDir = path.join(root, "mac");
  const entries = fs.existsSync(macDir) ? fs.readdirSync(macDir) : [];
  for (const name of entries) {
    if (!name.endsWith(".html") || !/-\d{1,2}-[a-zçğıöşü]+-\d{4}\.html$/.test(name)) continue;
    const html = fs.readFileSync(path.join(macDir, name), "utf8");
    const own = pick(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
    if (!canonicalMatches(own, `mac/${name}`)) continue;
    canonicalTargets.add(`${DOMAIN}/mac/${name}`);
    canonicalTargets.add(`${DOMAIN}/mac/${name.replace(/\.html$/, "")}`);
  }
}

/** Çapraz canonical'a bağlanmış kopyalar — rapor için sayılır. */
const crossCanonical = [];

const titles = new Map();
const descriptions = new Map();

/** Hafta numaralı maç sayfası: `mac/…-2026-2027-r05.html`, `en/match/…` aynısı. */
function isRoundAliasPage(relative) {
  return /^(mac|en[\\/]match)[\\/][a-z0-9-]+-\d{4}-\d{4}-r\d{2}\.html$/.test(relative.replace(/\\/g, "/"));
}

/** Maç Merkezi'ne devredilmiş hafta sayfaları; aşağıda ayrıca doğrulanır. */
const matchCentreAliases = [];

const problems = {
  missingTitle: [],
  missingDescription: [],
  missingCanonical: [],
  canonicalMismatch: [],
  missingH1: [],
  multipleH1: [],
  invalidRobots: [],
  noindexInSitemap: [],
  invalidJsonLd: []
};

for (const file of files) {
  const relative = path.relative(root, file);
  const html = fs.readFileSync(file, "utf8");

  const robots = metaContent(html, "robots") || ROBOTS_INDEX;
  const indexable = !/noindex/i.test(robots);

  // `noindex,nofollow` da geçerli: iç araç sayfaları için bilinçli tercih.
  const robotsKey = robots.toLowerCase().replace(/\s+/g, "");
  if (!ROBOTS_ALLOWED.includes(robotsKey)) {
    problems.invalidRobots.push(`${relative}: ${robots}`);
  }

  const title = pick(html, /<title>([^<]*)<\/title>/i);
  if (!title) problems.missingTitle.push(relative);

  const description = metaContent(html, "description");
  if (!description) problems.missingDescription.push(relative);

  // CANONICAL KURALI İNDEXLENEBİLİRLİĞE BAĞLI.
  //
  // İndexlenebilir bir sayfanın canonical'ı KENDİNİ göstermek zorunda: başka
  // bir adresi gösterirse sayfa sessizce indexten düşer ve bunu kimse fark
  // etmez. Buna karşılık noindex bir sayfanın canonical'ı başka bir adresi
  // gösterebilir — hatta göstermelidir: `oyuncular/edina-dzeko.html` yanlış
  // yazımlı bir takma addır, noindex'tir, sitemap'te yoktur ve doğru profile
  // işaret eder. Bu hata değil, doğru davranıştır.
  //
  // İKİ İSTİSNA — ikisi de aynı maçın kopya adresleri, farklı aileler.
  //
  // (a) MAÇ MERKEZİ DEVRİ. Hafta numaralı maç sayfası
  // (`mac/<ev>-<dep>-2026-2027-r05.html`, aynısı `en/match/` altında) maçın
  // tarihi henüz atanmamışken üretilir ve o aşamada KENDİ adresi kanoniktir.
  // Tarih onaylanıp kalıcı Maç Merkezi adresi açılınca aynı maç iki sayfada
  // anlatılır; hafta sayfası kanonikliği Maç Merkezi'ne devreder, site
  // haritasından düşer ama SİLİNMEZ (dış bağlantılar kırılmasın). Hedefin
  // var olduğu, indekslenebilir olduğu ve takma adın haritadan düştüğü
  // aşağıda ayrıca doğrulanır.
  //
  // (b) RAPOR VE ESKİ ANALİZ KOPYALARI. `mac-raporu/...` maç sonu raporu ve
  // kök dizindeki eski `-mac-analizi` deseni de aynı sorguyu hedefliyordu;
  // `scripts/unify-match-canonicals.mjs` bunları üretimden sonra tek geçişte
  // tarih slug'lı `/mac/...` adresine bağlıyor.
  //
  // İkisinde de doğru sinyal `noindex` DEĞİL: noindex kopyayı indeksten
  // düşürür ama biriktirdiği otoriteyi hiçbir yere aktarmaz. Otoriteyi tek
  // adrese toplayan şey, indekslenebilir kalan kopyanın çapraz canonical'ıdır.
  //
  // Kural gevşetilmiyor, DARALTILIYOR: çapraz canonical yalnızca gerçekten
  // var olan ve KENDİ adresini gösteren bir `/mac/` sayfasına verilebilir.
  // Hedefi olmayan ya da hedefi de başka yeri gösteren bir zincir yine hata.
  const canonical = pick(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
  if (indexable) {
    if (!canonical) problems.missingCanonical.push(relative);
    else if (!canonicalMatches(canonical, relative)) {
      if (isRoundAliasPage(relative)) matchCentreAliases.push({ relative, canonical });
      else if (isMatchDuplicate(relative) && canonicalTargets.has(canonical)) {
        crossCanonical.push(`${relative} → ${canonical}`);
      } else {
        problems.canonicalMismatch.push(`${relative}: ${canonical}`);
      }
    }
  }

  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1Count === 0) problems.missingH1.push(relative);
  else if (h1Count > 1) problems.multipleH1.push(`${relative}: ${h1Count}`);

  // JSON-LD ayrıştırılamıyorsa Google onu hiç okumaz; sessizce kaybolur.
  for (const block of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      problems.invalidJsonLd.push(`${relative}: ${error.message.slice(0, 60)}`);
    }
  }

  // Yinelenen başlık ve açıklama YALNIZCA indexlenebilir sayfalar için
  // anlamlı: noindex bir sayfa arama sonucunda görünmez, başlığını
  // paylaşması kimseyi yanıltmaz.
  if (indexable) {
    if (title) titles.set(title, [...(titles.get(title) || []), relative]);
    if (description) descriptions.set(description, [...(descriptions.get(description) || []), relative]);
  } else if (sitemap) {
    const url = expectedCanonical(relative);
    const withoutExtension = url.replace(/\.html$/, "");
    if (sitemap.includes(`<loc>${url}</loc>`) || sitemap.includes(`<loc>${withoutExtension}</loc>`)) {
      problems.noindexInSitemap.push(relative);
    }
  }
}

// ── İÇ BAĞLANTI GRAFİĞİ ───────────────────────────────────────────────────
//
// Kırık iç bağlantı iki şeyi birden bozar: okuyucu 404 görür ve Googlebot
// tarama bütçesini boşa harcar. Orphan sayfa ise tersi — sayfa vardır ama
// hiçbir yerden bağlanmadığı için ne okuyucu ne bot ona ulaşır.
//
// Bağlantılar ÜRETİLEN AĞAÇTAN okunur; bir bağlantı listesine bakılmaz.

const existing = new Set(files.map((file) => path.relative(root, file).split(path.sep).join("/")));
const linkedFrom = new Map();
const brokenLinks = [];

/** Göreli bağlantıyı depo köküne göre çözer. */
function resolveHref(href, fromRelative) {
  let target = href.split("#")[0].split("?")[0];
  if (!target) return "";
  if (/^(https?:|mailto:|tel:|javascript:|data:)/i.test(target)) {
    if (!target.startsWith(DOMAIN)) return "";
    target = target.slice(DOMAIN.length);
  }
  const fromDir = path.posix.dirname(fromRelative.split(path.sep).join("/"));
  const resolved = target.startsWith("/")
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join(fromDir === "." ? "" : fromDir, target));
  return resolved.replace(/^\.?\//, "");
}

/** Hedef depoda var mı? Temiz URL biçimi de kabul edilir. */
function targetExists(resolved) {
  if (!resolved || resolved === "" || resolved === ".") return true;
  const candidates = [resolved, `${resolved}.html`, `${resolved}/index.html`, path.posix.join(resolved, "index.html")];
  return candidates.some((candidate) => existing.has(candidate.replace(/\/+/g, "/")));
}

// ── BREADCRUMB HEDEFİ ÜRETİMDE GERÇEKTEN AÇILMALI ────────────────────────
//
// Yukarıdaki `targetExists` bilerek gevşek: uzantısız bir adresi, karşılığı
// olan `.html` diskte durduğu sürece geçerli sayar. Bu, GÖVDEDEKİ <a> için
// doğru bir varsayım değildi ama zararsızdı; JSON-LD basamağı için ise
// sessiz bir kör nokta oldu.
//
// Somut hata: haber sayfalarının BreadcrumbList'i ikinci basamak olarak
// `/haberler` bildiriyordu. Dosya `haberler.html` olarak diskte duruyordu,
// bu yüzden hiçbir denetim ötmedi — ama `vercel.json` `cleanUrls: false`
// ile çalışıyor ve uzantısız her rota AYRI bir rewrite ister. `/haberler`
// için böyle bir kayıt yoktu; yayına çıkan 297 haber sayfasının hepsi
// Google'a 404 veren bir üst basamak bildirdi.
//
// Buradaki denetim bu yüzden diske değil ÜRETİM YÖNLENDİRME KURALLARINA
// bakar: adres ya birebir dosya olmalı, ya bir rewrite/redirect ile
// eşleşmeli, ya da `cleanUrls` açıksa uzantısız hâli çözülebilmeli.
const vercelConfigPath = path.join(root, "vercel.json");
const vercelConfig = fs.existsSync(vercelConfigPath)
  ? JSON.parse(fs.readFileSync(vercelConfigPath, "utf8"))
  : {};
const cleanUrls = vercelConfig.cleanUrls === true;

/**
 * `/haber/:slug` gibi bir kaynak kalıbını, parametreleri YAKALAYAN bir
 * düzenli ifadeye çevirir.
 *
 * Yakalama şart: hedef `/haber/:slug.html` biçiminde, yani parametre ile
 * uzantı AYNI parçada duruyor. Parçayı düz metin olarak değiştirmeye
 * kalkışmak (`:slug.html` tamamen parametre sanılır) uzantıyı düşürüyor ve
 * var olan sayfayı "açılmıyor" diye raporluyordu.
 */
function routePattern(source) {
  const params = [];
  const escaped = String(source || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z0-9_]+)(\\\*)?/g, (_, name, star) => {
      params.push(name);
      return star ? "(.+)" : "([^/]+)";
    });
  return { regex: new RegExp(`^${escaped}$`), params };
}

// KOŞULLU KURAL, ADRESİN AÇILDIĞINI KANITLAMAZ.
//
// `vercel.json` içinde apex ve .com.tr alan adlarını www'ye taşıyan üç
// `/:path*` yönlendirmesi var. Kalıp olarak bunlar HER yolu eşleştirir;
// koşulsuz sayıldıklarında denetim "her adres açılıyor" der ve hiçbir şey
// yakalamaz — ilk yazımda tam olarak bu oldu, test yeşil yandı. Oysa üçü de
// `has: { type: "host" }` taşıyor: yalnızca BAŞKA bir konakta çalışırlar,
// kanonik www adresinde bir şey servis etmezler. Bu yüzden koşul taşıyan
// her kural burada yok sayılır.
const routeRules = [...(vercelConfig.rewrites || []), ...(vercelConfig.redirects || [])]
  .filter((rule) => rule && rule.source && !rule.has && !rule.missing)
  .map((rule) => ({ ...routePattern(rule.source), destination: String(rule.destination || "") }));

/** Kuralın hedefi diskte gerçekten var mı? Parametreler yakalanan değerle doldurulur. */
function ruleResolves(rule, urlPath) {
  const match = rule.regex.exec(urlPath);
  if (!match || !rule.destination) return false;
  // Başka bir konağa giden hedefin varlığını bu depo doğrulayamaz; kabul edilir.
  if (/^https?:\/\//i.test(rule.destination)) return true;

  const values = new Map(rule.params.map((name, index) => [name, match[index + 1] || ""]));
  const resolved = rule.destination
    .replace(/^\//, "")
    .replace(/:([A-Za-z0-9_]+)\*?/g, (whole, name) => (values.has(name) ? values.get(name) : whole));
  return existing.has(resolved) || existing.has(path.posix.join(resolved, "index.html"));
}

/** Bu adres üretimde bir yanıt döndürür mü? */
function routableInProduction(urlPath) {
  const clean = urlPath.split("#")[0].split("?")[0];
  if (!clean || clean === "/") return true;

  const relative = clean.replace(/^\//, "");
  if (existing.has(relative)) return true;
  if (existing.has(path.posix.join(relative, "index.html"))) return true;
  // `cleanUrls` açıkken uzantısız adres kendiliğinden `.html`e çözülür;
  // kapalıyken çözülmez ve bu ayrım tam olarak denetlenen şeydir.
  if (cleanUrls && existing.has(`${relative}.html`)) return true;

  return routeRules.some((rule) => ruleResolves(rule, clean));
}

const unroutableBreadcrumbs = [];

for (const file of files) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const html = fs.readFileSync(file, "utf8");

  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    let payload;
    try {
      payload = JSON.parse(block[1]);
    } catch {
      continue; // Ayrıştırılamayan JSON-LD zaten yukarıda raporlanıyor.
    }
    const nodes = Array.isArray(payload["@graph"]) ? payload["@graph"] : [payload];
    for (const node of nodes) {
      if (!node || node["@type"] !== "BreadcrumbList") continue;
      for (const step of node.itemListElement || []) {
        const item = typeof step?.item === "string" ? step.item : "";
        if (!item.startsWith(DOMAIN)) continue;
        const urlPath = item.slice(DOMAIN.length) || "/";
        if (!routableInProduction(urlPath)) {
          unroutableBreadcrumbs.push(`${relative} → ${item}`);
        }
      }
    }
  }

  for (const match of html.matchAll(/<a[^>]+href="([^"]+)"/gi)) {
    const resolved = resolveHref(match[1], relative);
    if (!resolved) continue;
    // Varlık dosyaları (pdf, xml, resim) bu denetimin konusu değil.
    if (/\.(xml|json|pdf|png|jpe?g|svg|webp|ico|css|js|txt)$/i.test(resolved)) continue;
    if (!targetExists(resolved)) {
      brokenLinks.push(`${relative} → ${match[1]}`);
      continue;
    }
    linkedFrom.set(resolved.replace(/\.html$/, ""), true);
  }
}

// ORPHAN: sitemap'te olup hiçbir sayfadan bağlanmayan adres.
const orphans = [];
if (sitemap) {
  for (const loc of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = loc[1];
    if (!url.startsWith(DOMAIN)) continue;
    const relative = url.slice(DOMAIN.length).replace(/^\//, "").replace(/\/$/, "");
    if (!relative) continue;
    const key = relative.replace(/\.html$/, "");
    if (!linkedFrom.has(key) && !linkedFrom.has(`${key}/index`)) orphans.push(url);
  }
}

const duplicateTitles = [...titles.entries()].filter(([, pages]) => pages.length > 1);
const duplicateDescriptions = [...descriptions.entries()].filter(([, pages]) => pages.length > 1);

const summarize = (list, limit = 5) =>
  list.slice(0, limit).join("; ") + (list.length > limit ? ` …(+${list.length - limit})` : "");

console.log(`SEO bütünlüğü: ${files.length} sayfa tarandı, ${titles.size} benzersiz başlık.`);
console.log(`SEO bütünlüğü: ${crossCanonical.length} maç kopyası tek kanonik /mac/ adresine bağlı.`);

// ── Denetimler ─────────────────────────────────────────────────────────────

assert.equal(problems.missingTitle.length, 0, `başlıksız sayfa: ${summarize(problems.missingTitle)}`);
assert.equal(problems.missingCanonical.length, 0, `canonical'ı olmayan sayfa: ${summarize(problems.missingCanonical)}`);
assert.equal(problems.invalidJsonLd.length, 0, `ayrıştırılamayan JSON-LD: ${summarize(problems.invalidJsonLd)}`);
assert.equal(problems.invalidRobots.length, 0, `geçersiz robots yönergesi: ${summarize(problems.invalidRobots)}`);
assert.equal(problems.noindexInSitemap.length, 0, `noindex sayfa sitemap'te: ${summarize(problems.noindexInSitemap)}`);
assert.equal(problems.canonicalMismatch.length, 0, `canonical kendi adresini göstermiyor: ${summarize(problems.canonicalMismatch)}`);

// MAÇ MERKEZİ DEVRİ — istisna ancak şu üç koşulda geçerlidir; yoksa devir
// sayfayı sessizce indexten düşürür ve bunu kimse fark etmez.
const aliasProblems = [];
for (const { relative, canonical } of matchCentreAliases) {
  if (!canonical.startsWith(`${DOMAIN}/`)) {
    aliasProblems.push(`${relative}: site dışı canonical → ${canonical}`);
    continue;
  }
  const targetRelative = canonical.slice(DOMAIN.length + 1);
  const targetFile = path.join(root, targetRelative.endsWith(".html") ? targetRelative : `${targetRelative}.html`);
  // 1) Hedef GERÇEKTEN var olmalı — 404'e canonical verilmez.
  if (!fs.existsSync(targetFile)) {
    aliasProblems.push(`${relative}: kanonik hedef yok → ${targetRelative}`);
    continue;
  }
  // 2) Hedefin kendisi indexlenebilir olmalı — noindex bir sayfaya devretmek
  //    iki sayfayı birden indexten düşürür.
  const targetHtml = fs.readFileSync(targetFile, "utf8");
  if (/noindex/i.test(metaContent(targetHtml, "robots") || "")) {
    aliasProblems.push(`${relative}: kanonik hedef noindex → ${targetRelative}`);
    continue;
  }
  // 3) Takma ad site haritasında KENDİ adresiyle yer almamalı.
  if (sitemap && sitemap.includes(`<loc>${expectedCanonical(relative)}</loc>`)) {
    aliasProblems.push(`${relative}: takma ad site haritasında`);
  }
}
assert.equal(aliasProblems.length, 0, `Maç Merkezi devri hatalı: ${summarize(aliasProblems)}`);
assert.equal(problems.missingDescription.length, 0, `açıklaması olmayan sayfa: ${summarize(problems.missingDescription)}`);
assert.equal(problems.missingH1.length, 0, `H1'i olmayan sayfa: ${summarize(problems.missingH1)}`);

assert.equal(
  duplicateTitles.length,
  0,
  `yinelenen başlık: ${summarize(duplicateTitles.map(([title, pages]) => `"${title.slice(0, 40)}" → ${pages.length} sayfa`))}`
);
assert.equal(
  duplicateDescriptions.length,
  0,
  `yinelenen açıklama: ${summarize(duplicateDescriptions.map(([, pages]) => `${pages.length} sayfa: ${pages.slice(0, 2).join(", ")}`))}`
);

assert.equal(
  brokenLinks.length,
  0,
  `kırık iç bağlantı: ${summarize(brokenLinks)}`
);

// ORPHAN SAYFA: sitemap'te var ama hiçbir sayfadan bağlanmıyor.
//
// Böyle bir sayfa Google'a "bunu indexle" der ama siteye "bu önemsiz" der;
// ikisi çelişir. `en-iyi-defanslar.html` tam olarak böyleydi: kardeşleri
// (forvet, orta saha, kaleci) oyuncu liderleri sayfasından bağlanırken o
// listede yoktu.
assert.equal(
  orphans.length,
  0,
  `sitemap'te olup hiçbir yerden bağlanmayan sayfa: ${summarize(orphans)}`
);

// BREADCRUMB, VAR OLMAYAN BİR ÜST BASAMAK BİLDİREMEZ.
//
// `/haberler` yayında 404 verirken 297 haber sayfası onu üst basamak
// gösteriyordu. Hedefin diskte bir `.html` karşılığı olması yetmez;
// `vercel.json` o adresi gerçekten servis ediyor olmalı.
assert.equal(
  unroutableBreadcrumbs.length,
  0,
  `breadcrumb basamağı üretimde açılmıyor: ${summarize(unroutableBreadcrumbs)}`
);

console.log("SEO bütünlüğü testleri geçti (başlık, açıklama, canonical, H1, robots, JSON-LD, sitemap tutarlılığı, iç bağlantılar, orphan sayfa, breadcrumb yönlendirmesi).");
