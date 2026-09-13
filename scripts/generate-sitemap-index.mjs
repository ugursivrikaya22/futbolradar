#!/usr/bin/env node
/**
 * SİTE HARİTASI BÖLÜMLEME — `sitemap-en.xml` + `sitemap-index.xml`.
 *
 * Site tek bir `sitemap.xml` yayımlıyordu: 1,4 MB, ~8.000 adres, Türkçe ve
 * İngilizce iç içe. Bu dosya çalışıyor ama İngilizce tarafı YÖNETİLEMEZ
 * kılıyordu — Search Console'da "İngilizce sayfalarımın kaçı indekslendi"
 * sorusunun cevabı yoktu, çünkü kapsam raporu site haritası BAŞINA verilir.
 *
 * Bu adım İngilizce adresleri AYRI bir haritaya kopyalar ve ikisini bir
 * indeks dosyasında toplar:
 *
 *   sitemap-index.xml → sitemap.xml, sitemap-en.xml, news-sitemap.xml
 *
 * `sitemap.xml` OLDUĞU GİBİ KALIYOR, kırpılmıyor. Üç ayrı üretici o dosyayı
 * yeniden yazıyor (bkz. scripts/lib/sitemap.mjs); buradan içerik silmek,
 * sıradaki derlemede geri gelecek bir değişiklik olurdu. Üstelik Google için
 * bir adresin İKİ haritada birden bulunması sorun değil — kapsam raporu
 * ayrışsın diye zaten istenen şey bu.
 *
 * ADIM EN SONDA ÇALIŞIR: kendinden önceki her üretici `sitemap.xml`e yazmış
 * olmalı, yoksa İngilizce kopya eksik çıkar.
 */
import fs from "node:fs";
import path from "node:path";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";
const EN_PREFIX = `${DOMAIN}/en`;

/** `<loc>` içindeki adres — girdiyi hangi dile ait sayacağımızın tek ölçütü. */
function locOf(entryXml) {
  const match = entryXml.match(/<loc>([^<]+)<\/loc>/);
  return match ? match[1].trim() : "";
}

function isEnglish(entryXml) {
  const loc = locOf(entryXml);
  return loc === EN_PREFIX || loc.startsWith(`${EN_PREFIX}/`);
}

function lastmodOf(entryXml) {
  const match = entryXml.match(/<lastmod>([^<]+)<\/lastmod>/);
  return match ? match[1].trim() : "";
}

/** İndeks girdisi; `lastmod` haritadaki EN YENİ tarihtir. */
function indexEntry(filename, lastmod) {
  return `  <sitemap>\n    <loc>${DOMAIN}/${filename}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ""}\n  </sitemap>`;
}

function newestLastmod(entries) {
  return entries.map(lastmodOf).filter(Boolean).sort().at(-1) || "";
}

function readEntries(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").match(URL_ENTRY_RE) || [];
}

let englishCount = 0;

for (const outputRoot of [root, path.join(root, "public")]) {
  const sitemapPath = path.join(outputRoot, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) continue;

  const entries = readEntries(sitemapPath);
  const english = entries.filter(isEnglish);
  englishCount = english.length;

  // İngilizce harita — girdiler ana haritadan BİREBİR kopyalanır, yeniden
  // türetilmez: `lastmod`, `changefreq`, `priority` ve hreflang alternate
  // çocukları neyse o kalır. Yeniden türetmek iki harita arasında sessiz bir
  // ayrışma üretirdi.
  fs.writeFileSync(path.join(outputRoot, "sitemap-en.xml"), wrapUrlset(english), "utf8");

  const newsPath = path.join(outputRoot, "news-sitemap.xml");
  const indexEntries = [
    indexEntry("sitemap.xml", newestLastmod(entries)),
    indexEntry("sitemap-en.xml", newestLastmod(english))
  ];
  if (fs.existsSync(newsPath)) {
    indexEntries.push(indexEntry("news-sitemap.xml", newestLastmod(readEntries(newsPath))));
  }

  fs.writeFileSync(
    path.join(outputRoot, "sitemap-index.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexEntries.join("\n")}\n</sitemapindex>\n`,
    "utf8"
  );
}

/**
 * robots.txt — indeks ve İngilizce harita ilan edilir.
 *
 * `sitemap.xml` satırı KALIYOR: hâlihazırda Search Console'a gönderilmiş ve
 * taranıyor; kaldırmak çalışan bir bildirimi kırmak olurdu. Satırlar
 * tekilleştirilerek yazılıyor, yani bu adım tekrar tekrar çalıştırılabilir.
 */
const robotsPath = path.join(root, "robots.txt");
if (fs.existsSync(robotsPath)) {
  const original = fs.readFileSync(robotsPath, "utf8");
  const wanted = ["sitemap-index.xml", "sitemap.xml", "sitemap-en.xml", "news-sitemap.xml"]
    .map((name) => `Sitemap: ${DOMAIN}/${name}`);
  const body = original.replace(/^Sitemap:.*$/gim, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  const next = `${body}\n\n${wanted.join("\n")}\n`;
  if (next !== original) {
    fs.writeFileSync(robotsPath, next, "utf8");
    const publicRobots = path.join(root, "public", "robots.txt");
    if (fs.existsSync(publicRobots)) fs.writeFileSync(publicRobots, next, "utf8");
  }
}

console.log(`[sitemap-index] sitemap-en.xml: ${englishCount} English URLs; sitemap-index.xml written.`);
