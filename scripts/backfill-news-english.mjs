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
 *   node scripts/backfill-news-english.mjs --repair  # eksik özne/tutarı onarır (rapor)
 *   node scripts/backfill-news-english.mjs --repair --apply
 *
 * --repair: İngilizcesi VAR ama Türkçe gövdenin taşıdığı özneyi ya da tutarı
 * düşürmüş (ya da tutarı çevrilmemiş Türkçe parça olarak basmış) şablonlu
 * haberleri onarır. Özne ve tutar Türkçe gövdedeki cümleden geri kazanılır
 * ("Gündemdeki isim X olarak öne çıkıyor", "Aktarılan tutar Y olarak
 * konuşuluyor"); yeni bilgi uydurulmaz. Yalnızca eksik olan kayıt yeniden
 * kurulur, diğerlerine dokunulmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildEnglishArticle, dedupeEnglishSeo, recoverDetailsFromTurkish } = require("../services/sporxNews.js");

const root = process.cwd();
const STORE = path.join(root, "data", "news.json");
const apply = process.argv.includes("--apply");
// Şablonlar değiştiğinde var olan İngilizce blokları da yeniden üretmek için.
const force = process.argv.includes("--force");
// Var olan ama eksik/Türkçe sızıntılı İngilizce bloğu onarır.
const repair = process.argv.includes("--repair");

const news = JSON.parse(fs.readFileSync(STORE, "utf8"));

let created = 0;
let already = 0;
let repaired = 0;
const editorial = [];
const repairedSlugs = [];

/** İngilizce gövdede özne/tutar cümlesi var mı, tutar çevrilmiş mi? */
function needsRepair(article, details) {
  const body = (article.en && Array.isArray(article.en.body) ? article.en.body : []).join(" ");
  const lacksName = Boolean(details.player) && !/The name in the spotlight is/.test(body);
  const figure = body.match(/The figure being discussed is ([^\n]*?)\.(?:\s|$)/);
  const lacksAmount = Boolean(details.amount) && !figure;
  // Çevrilmemiş ("80 milyon euro") ya da ham Türkçe tutar.
  const untranslatedAmount = Boolean(figure) && /(milyon|\bbin\b|avro|\btl\b|dolar)/i.test(figure[1]);
  return lacksName || lacksAmount || untranslatedAmount;
}

for (const article of news) {
  if (repair) {
    const discovery = article.discovery || {};
    if (!discovery.eventType || !article.en || !Array.isArray(article.en.body)) continue;
    const details = recoverDetailsFromTurkish(article);
    if (!needsRepair(article, details)) continue;
    article.en = buildEnglishArticle({
      team: article.team,
      player: discovery.subject || details.player,
      eventType: discovery.eventType,
      confidence: discovery.confidence,
      amount: details.amount,
      sourceName: "Sporx",
      category: article.category,
      slug: article.slug,
      tags: article.tags
    });
    repaired += 1;
    repairedSlugs.push(article.slug);
    continue;
  }
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

if (repair) {
  console.log(`[news-en] --repair: ${repaired} haberin İngilizcesi onarıldı (toplam=${news.length}).`);
  for (const slug of repairedSlugs) console.log(`           - ${slug}`);
} else console.log(`[news-en] toplam=${news.length} üretildi=${created} zaten-vardı=${already} editoryal-atlandı=${editorial.length}`);
if (!repair && editorial.length) {
  console.log(`[news-en] elle yazılmış ve İngilizcesi olmayan haberler (İngilizce yüzeyde görünmezler):`);
  for (const slug of editorial) console.log(`           - ${slug}`);
}

if (!apply) {
  console.log("[news-en] --apply verilmedi; dosya yazılmadı.");
  process.exit(0);
}

fs.writeFileSync(STORE, `${JSON.stringify(news, null, 2)}\n`, "utf8");
console.log(`[news-en] data/news.json güncellendi.`);
