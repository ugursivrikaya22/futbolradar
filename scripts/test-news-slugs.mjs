/**
 * Haber adresleri: okunur slug, eski özet kodlu adreslerden 301, gerçek
 * başlıkla iç bağlantı metni.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readComparisonMap } from "./lib/middlewareSource.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { isHashedSlug, readableSlug, slugify } = require("../services/newsSlug.js");
const { buildArticle, classifyCandidate } = require("../services/sporxNews.js");

let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// --- Slug üretimi ---
expect(slugify("Beşiktaş'ta Adalı'ya ilişkin açıklama iddiası") === "besiktasta-adaliya-iliskin-aciklama-iddiasi", "kesme işareti sözcüğü bölmemeli");
expect(slugify("İstanbul ÇAĞRI Işık") === "istanbul-cagri-isik", "Türkçe büyük harfler (İ, I) doğru indirgenmeli");
expect(isHashedSlug("besiktas-adali-960ce1d5") && !isHashedSlug("besiktasta-adaliya-iliskin-aciklama-iddiasi"), "özet kodlu slug tespiti");
{
  const taken = new Set(["ornek-baslik"]);
  const dated = readableSlug("Örnek başlık", { taken, publishedAt: "2026-11-05T10:00:00Z" });
  expect(dated === "ornek-baslik-2026-11-05", `çakışmada yayın tarihi eklenmeli: ${dated}`);
  taken.add(dated);
  const numbered = readableSlug("Örnek başlık", { taken, publishedAt: "2026-11-05T10:00:00Z" });
  expect(numbered === "ornek-baslik-2", `tarih de doluysa sıra numarası: ${numbered}`);
  expect(!isHashedSlug(dated) && !isHashedSlug(numbered), "çakışma çözümü özet kodu üretmemeli");
  const long = readableSlug("a".repeat(30) + " " + "b".repeat(30) + " " + "c".repeat(30) + " ddd");
  expect(long.length <= 90 && !long.endsWith("-"), "uzun başlık sözcük sınırında kısalmalı");
  expect(readableSlug("") === "haber", "boş başlık için sabit yedek");
}

// --- Yeni üretilen haber okunur slug alır ---
{
  const candidate = { title: "Galatasaray Mauro Icardi için resmi açıklama", url: "https://www.sporx.com/x-SXHBQ1SX", summary: "", publishedAt: "2026-11-20T10:00:00Z" };
  const classification = classifyCandidate(candidate);
  if (classification) {
    const first = buildArticle({ candidate, classification, now: new Date("2026-11-20T10:05:00Z") });
    expect(!isHashedSlug(first.slug), `yeni haber özet kodu taşımamalı: ${first.slug}`);
    expect(first.slug === slugify(first.title), `slug başlıktan türemeli: ${first.slug}`);
    const second = buildArticle({ candidate, classification, now: new Date("2026-11-20T10:05:00Z"), existingSlugs: [first.slug] });
    expect(second.slug !== first.slug, "çakışan başlık aynı slug'ı almamalı");
    expect(first.url.endsWith(`/haber/${first.slug}`) && first.seo.canonical.endsWith(`/haber/${first.slug}`), "url ve canonical slug ile tutarlı");
  }
}

// --- Veri: özet kodlu slug kalmadı, yönlendirme tablosu tutarlı ---
const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const redirects = JSON.parse(fs.readFileSync(path.join(root, "data", "news-slug-redirects.json"), "utf8")).redirects;
const live = new Set(news.map((a) => a.slug || a.id));
expect(live.size === news.length, "haber slug'ları tekil olmalı");
expect(!news.some((a) => isHashedSlug(a.slug || a.id)), "data/news.json'da özet kodlu slug kalmamalı");
expect(Object.keys(redirects).length >= 697, "yönlendirme tablosu taşınan tüm slug'ları içermeli");
for (const [from, to] of Object.entries(redirects)) {
  if (!live.has(to)) { expect(false, `yönlendirme hedefi yayında değil: ${from} → ${to}`); break; }
  if (Object.prototype.hasOwnProperty.call(redirects, to)) { expect(false, `zincirleme yönlendirme: ${from} → ${to}`); break; }
  if (live.has(from)) { expect(false, `eski slug hâlâ yayında: ${from}`); break; }
}
for (const article of news) {
  const slug = article.slug || article.id;
  if (!Object.values(redirects).includes(slug)) continue; // yalnızca taşınanlar
  if (article.url && !article.url.endsWith(`/haber/${slug}`)) { expect(false, `${slug}: url slug ile uyumsuz`); break; }
  if (article.seo && article.seo.canonical && !article.seo.canonical.endsWith(`/haber/${slug}`)) { expect(false, `${slug}: canonical slug ile uyumsuz`); break; }
}
{
  // Üretilmiş sayfalar: özet kodlu dosya kalmamalı; taşınan sayfalar yeni adla var.
  for (const dir of ["haber", "public/haber"]) {
    const files = fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith(".html"));
    const hashed = files.filter((name) => isHashedSlug(name.replace(/\.html$/, "")));
    expect(hashed.length === 0, `${dir}: özet kodlu sayfa kalmış: ${hashed.slice(0, 3).join(", ")}`);
  }
  const targets = new Set(Object.values(redirects));
  const present = [...targets].filter((slug) => fs.existsSync(path.join(root, "haber", `${slug}.html`)));
  expect(present.length >= targets.size * 0.9, `taşınan sayfaların çoğu yeni adla var olmalı (${present.length}/${targets.size})`);
}

// --- middleware: 301, tek atlama ---
{
  const source = fs.readFileSync(path.join(root, "middleware.js"), "utf8");
  const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const call = (p) => {
    const response = mod.default(new Request(`https://www.futbolradar.com${p}`));
    return response ? { status: response.status, location: response.headers.get("location") } : null;
  };
  const [from, to] = Object.entries(redirects)[0];
  for (const p of [`/haber/${from}`, `/haber/${from}.html`]) {
    const r = call(p);
    expect(r && r.status === 301 && r.location === `https://www.futbolradar.com/haber/${to}`, `${p} → 301 ${to}`);
  }
  const en = call(`/en/news/${from}`);
  expect(en && en.status === 301 && en.location === `https://www.futbolradar.com/en/news/${to}`, "İngilizce haber adresi de 301 olmalı");
  expect(call(`/haber/${to}`) === null, "yeni adres yönlendirilmemeli");
  expect(call("/haber/constructor") === null && call("/haber/__proto__") === null, "prototip anahtarları yönlendirme sayılmamalı");
  expect(call("/haber/olmayan-bir-haber") === null, "bilinmeyen adres statik sayfaya düşmeli");
  const comparison = readComparisonMap(source);
  const [reverse, canonical] = Object.entries(comparison)[0];
  const cmp = call(`/karsilastirma/${reverse}`);
  expect(cmp && cmp.status === 301 && cmp.location.endsWith(`/karsilastirma/${canonical}`), "ters kıyas yönlendirmesi korunmalı");
  expect(/matcher: \[[^\]]*\/haber\/:path\*[^\]]*\/en\/news\/:path\*/.test(source), "matcher haber adreslerini kapsamalı");
}

// --- İç bağlantı metni: "Haber: slug özet-kodu" kalmamalı ---
// (Etiketi başlıktan üreten kod #859'da; burada commit'lenmiş sayfalarda
// özet kodlu etiket ve bağlantı kalmadığı denetlenir.)
{
  const LABEL = /Haber: [a-z0-9]+(?: [a-z0-9]+)* [0-9a-f]{8}</;
  const LINK = /href="[^"]*\/haber\/[a-z0-9-]*-[0-9a-f]{8}(?:\.html)?"/;
  const dirs = ["takimlar", "kose-yazilari"];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".html")) files.push(rel);
    }
  };
  for (const dir of dirs) walk(dir);
  for (const name of fs.readdirSync(root)) if (name.endsWith(".html")) files.push(name);
  const badLabel = [];
  const badLink = [];
  for (const rel of files) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    if (LABEL.test(html)) badLabel.push(rel);
    if (LINK.test(html)) badLink.push(rel);
  }
  expect(badLabel.length === 0, `özet kodlu "Haber: ..." bağlantı metni kalmış (${badLabel.length}): ${badLabel.slice(0, 3).join(", ")}`);
  expect(badLink.length === 0, `eski özet kodlu haber adresine bağlantı kalmış (${badLink.length}): ${badLink.slice(0, 3).join(", ")}`);
}

if (failures) {
  console.error(`${failures} test failed.`);
  process.exit(1);
}
console.log("news slug tests passed");
