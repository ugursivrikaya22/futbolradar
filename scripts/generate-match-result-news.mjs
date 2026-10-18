#!/usr/bin/env node
/**
 * Doğrulanmış maç raporlarından `data/news.json` için maç sonucu haberi ekler.
 * Mantık scripts/lib/matchResultNews.mjs içinde. Yalnızca YENİ kayıt ekler;
 * mevcut haberlere dokunmaz; yeni kayıt yoksa dosyayı yazmaz.
 * Sıra: generate-post-match-pages (rapor sayfası) → bu adım → generate-news-pages.
 */
import fs from "node:fs";
import path from "node:path";
import { buildMatchResultNews } from "./lib/matchResultNews.mjs";

const root = process.cwd();
const reports = JSON.parse(fs.readFileSync(path.join(root, "data", "post-match-reports.json"), "utf8"));
const newsPath = path.join(root, "data", "news.json");
const raw = JSON.parse(fs.readFileSync(newsPath, "utf8"));
const list = Array.isArray(raw) ? raw : raw.news || raw.items || [];

const { added, skipped } = buildMatchResultNews(reports.records || [], list, {
  reportExists: (relative) => fs.existsSync(path.join(root, relative))
});
for (const item of skipped) console.log(`[match-result-news] atlandı: ${item.id} — ${item.reason}`);
if (!added.length) {
  console.log("[match-result-news] yeni haber yok.");
} else {
  const next = Array.isArray(raw) ? [...raw, ...added] : { ...raw, [raw.news ? "news" : "items"]: [...list, ...added] };
  fs.writeFileSync(newsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  for (const item of added) console.log(`[match-result-news] eklendi: ${item.id}`);
}
