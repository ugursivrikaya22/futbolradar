#!/usr/bin/env node
/**
 * Son işlem: birleşik sitemap.xml → türe göre çocuk haritalar + sitemap-index.xml.
 * Birleşik dosyaya dokunulmaz (üreticiler onu okumaya devam eder).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSplitSitemaps } from "./lib/sitemapBuckets.mjs";
import { NEWS_SITEMAP_FILE } from "./lib/newsSitemap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "sitemap.xml");
if (!fs.existsSync(source)) {
  console.log("sync-sitemap-index: sitemap.xml yok, atlandı.");
  process.exit(0);
}

const xml = fs.readFileSync(source, "utf8");
// Google News haritası birleşik urlset'in parçası değildir (kendi üreticisi,
// kendi ad alanı); indekste ayrı bir çocuk olarak bildirilir. Dosya yoksa
// bildirilmez — indeks var olmayan bir haritayı göstermesin.
const extraSitemaps = fs.existsSync(path.join(root, NEWS_SITEMAP_FILE)) ? [NEWS_SITEMAP_FILE] : [];
const { files, indexXml, total } = buildSplitSitemaps(xml, { extraSitemaps });
fs.mkdirSync(path.join(root, "sitemaps"), { recursive: true });
fs.mkdirSync(path.join(root, "public", "sitemaps"), { recursive: true });

for (const file of files) {
  fs.writeFileSync(path.join(root, file.file), file.xml, "utf8");
  fs.writeFileSync(path.join(root, "public", file.file), file.xml, "utf8");
}
fs.writeFileSync(path.join(root, "sitemap-index.xml"), indexXml, "utf8");
fs.writeFileSync(path.join(root, "public", "sitemap-index.xml"), indexXml, "utf8");

console.log(
  `sync-sitemap-index: ${total} URL → ${files.length} çocuk harita + sitemap-index.xml (${files.map((f) => `${f.id}:${f.count}`).join(", ")}${extraSitemaps.length ? `; ayrıca ${extraSitemaps.join(", ")}` : ""})`
);
