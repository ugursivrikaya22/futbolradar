#!/usr/bin/env node
/**
 * HABERLERİN İNGİLİZCE SÜRÜMLERİNİ GERİ DOLDURUR.
 *
 * NEDEN VAR: `/en` tarafında Türkçe haber gösterilmemesi kuralı servise
 * konulduğunda (services/newsFeed.js), İngilizcesi olmayan her haber
 * İngilizce yüzeyden DÜŞER. Kural doğru; ama arşivdeki yüzlerce haber
 * üretildikleri gün böyle bir alan taşımıyordu. Bu betik onları
 * yapısal verilerinden yeniden üretir.
 *
 * ÇEVİRİ YAPMAZ. Şablondan üretilmiş haberlerin metni zaten
 * `discovery.eventType`, `team`, `discovery.subject` ve
 * `discovery.confidence` alanlarından kuruluyor. İngilizce sürüm de aynı
 * alanlardan, İngilizce şablonlarla kurulur — yani iki dilin cümlesi de
 * kendi dilinde YAZILMIŞTIR, biri diğerinin çevirisi değildir.
 *
 * ELLE YAZILMIŞ HABERE DOKUNMAZ. `discovery.eventType` taşımayan kayıtlar
 * editoryal metindir; onları şablondan üretmek, yazılmamış bir cümleyi
 * yazılmış gibi göstermek olurdu. Bu kayıtlar raporlanır ve İngilizce
 * yüzeyde (çevirileri elle eklenene kadar) hiç görünmez.
 *
 * Kullanım:
 *   node scripts/backfill-news-english.mjs           # yalnızca rapor
 *   node scripts/backfill-news-english.mjs --apply   # data/news.json'u yazar
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildEnglishArticle, dedupeEnglishSeo } = require("../services/sporxNews.js");

const root = process.cwd();
const STORE = path.join(root, "data", "news.json");
const apply = process.argv.includes("--apply");
// Şablonlar değiştiğinde var olan İngilizce blokları da yeniden üretmek için.
const force = process.argv.includes("--force");

const news = JSON.parse(fs.readFileSync(STORE, "utf8"));

let created = 0;
let already = 0;
const editorial = [];

for (const article of news) {
  if (!force && article.en && article.en.title && Array.isArray(article.en.body) && article.en.body.length) {
    already += 1;
    continue;
  }

  const discovery = article.discovery || {};
  if (!discovery.eventType) {
    editorial.push(article.slug || article.id);
    continue;
  }

  article.en = buildEnglishArticle({
    team: article.team,
    player: discovery.subject,
    eventType: discovery.eventType,
    confidence: discovery.confidence,
    sourceName: "Sporx",
    category: article.category,
    slug: article.slug,
    tags: article.tags
  });
  created += 1;
}

// TEKİLLEŞTİRME ÜRETİMDEN SONRA. Şablon aynı takım + aynı olay türü için
// aynı cümleyi üretebilir; kopya başlık arama motorunda iki sayfayı da
// zayıflatır. Türkçe tarafla aynı algoritma, aynı belirlilik.
const deduped = dedupeEnglishSeo(news);
for (let index = 0; index < news.length; index += 1) news[index] = deduped[index];

console.log(`[news-en] toplam=${news.length} üretildi=${created} zaten-vardı=${already} editoryal-atlandı=${editorial.length}`);
if (editorial.length) {
  console.log(`[news-en] elle yazılmış ve İngilizcesi olmayan haberler (İngilizce yüzeyde görünmezler):`);
  for (const slug of editorial) console.log(`           - ${slug}`);
}

if (!apply) {
  console.log("[news-en] --apply verilmedi; dosya yazılmadı.");
  process.exit(0);
}

fs.writeFileSync(STORE, `${JSON.stringify(news, null, 2)}\n`, "utf8");
console.log(`[news-en] data/news.json güncellendi.`);
