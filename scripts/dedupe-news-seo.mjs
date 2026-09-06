#!/usr/bin/env node
/**
 * HABER DEPOSUNDA BAŞLIK/AÇIKLAMA TEKİLLİĞİ — data/news.json
 *
 * Sporx keşif hattı 2026-09-03'ten itibaren öznesiz şablon başlıklar üretti
 * ("Fenerbahçe'de gündeme ilişkin açıklama iddiası" 22 sayfada aynıydı).
 * scripts/qa.mjs yinelenen başlığı reddettiği için saatlik veri
 * güncellemesi üç gün commit'lenemedi. Kural artık keşif betiğinin
 * içinde (dedupeArticleSeo + isGenericArticle); bu betik aynı kuralı
 * ELDEKİ depoya uygular. İdempotent: ikinci koşuda hiçbir şey değişmez.
 *
 *   node scripts/dedupe-news-seo.mjs           # kuru koşu, değişecekleri listeler
 *   node scripts/dedupe-news-seo.mjs --apply   # data/news.json'ı yazar
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dedupeArticleSeo } = require("../services/sporxNews.js");

const root = process.cwd();
const NEWS_PATH = path.join(root, "data", "news.json");
const apply = process.argv.includes("--apply");

const payload = JSON.parse(fs.readFileSync(NEWS_PATH, "utf8"));
const list = Array.isArray(payload) ? payload : (payload.items || payload.news || []);
const next = dedupeArticleSeo(list);

const changed = [];
next.forEach((article, index) => {
  if (article !== list[index]) {
    const before = list[index];
    const titleNote = before.title === article.title ? "" : ` "${before.title}" → "${article.title}"`;
    const descriptionNote = (before.seo && before.seo.metaDescription) === (article.seo && article.seo.metaDescription) ? "" : " [açıklama ayrıştırıldı]";
    changed.push(`${article.slug || article.id}:${titleNote}${descriptionNote}`);
  }
});

console.log(`[dedupe-news-seo] ${list.length} haber tarandı, ${changed.length} kaydın başlığı/açıklaması ayrıştırıldı.`);
changed.forEach((line) => console.log(`  - ${line}`));

if (!apply) {
  console.log("[dedupe-news-seo] kuru koşu — --apply ile yazılır.");
} else if (changed.length) {
  const output = Array.isArray(payload) ? next : { ...payload, [payload.items ? "items" : "news"]: next };
  fs.writeFileSync(NEWS_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log("[dedupe-news-seo] data/news.json güncellendi.");
}
