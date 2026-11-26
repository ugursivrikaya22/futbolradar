#!/usr/bin/env node
/**
 * HABER VE KÖŞE YAZISI SAYFALARINDA NewsArticle EKSİKSİZ Mİ?
 *
 * Google News ve Article zengin sonuçlarının okuduğu yedi alan her haber
 * (`haber/`, `en/news/`) ve köşe yazısı (`kose-yazilari/`, `en/columns/`)
 * sayfasında dolu olmalı:
 *
 *   headline · datePublished · dateModified · author · publisher (logo dahil)
 *   · image · mainEntityOfPage
 *
 * Alanın VAR olması yetmez; her biri burada içerikçe de denetlenir:
 *   • tarihler ISO 8601 + saat dilimi, dateModified >= datePublished;
 *   • author: yayının kendisi (Organization, ad = yayın adı);
 *   • publisher: aynı ad + logo; logo dosyası depoda var;
 *   • image: mutlak, site içi ve dosyası depoda var;
 *   • mainEntityOfPage: sayfanın canonical adresi.
 *
 * Yayıncı düğümü tek tanımdan gelir (services/newsArticleSchema.js); bu test
 * tanımın kendisini de (logo boyutu gerçek dosyayla aynı mı) doğrular.
 *
 * YAZAR KURALI: bugün tüm yazılar kurum imzalıdır ("FutbolRadar"). İleride
 * adıyla yazan bir köşe yazarı eklenirse `HOUSE_AUTHOR_ONLY` bilinçli olarak
 * gevşetilmelidir — test o güne kadar sessiz bir ayrışmayı yakalar.
 *
 * Kullanım: node scripts/test-news-article-schema.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SITE_URL,
  PUBLICATION_NAME,
  PUBLISHER_LOGO,
  DEFAULT_ARTICLE_IMAGE,
  publisherNode,
  organizationAuthorNode
} = require("../services/newsArticleSchema.js");

const root = process.cwd();
const HOUSE_AUTHOR_ONLY = true;
const REQUIRED = ["headline", "datePublished", "dateModified", "author", "publisher", "image", "mainEntityOfPage"];
const SECTIONS = ["haber", "kose-yazilari", "en/news", "en/columns"];
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

console.log("news-article-schema");

const filled = (value) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);
const localFile = (url) => (typeof url === "string" && url.startsWith(`${SITE_URL}/`) ? path.join(root, decodeURI(url.slice(SITE_URL.length + 1))) : null);

/** PNG genişlik/yükseklik: IHDR, imzadan hemen sonra (bayt 16–23). */
function pngSize(file) {
  const head = fs.readFileSync(file).subarray(0, 24);
  assert.equal(head.subarray(1, 4).toString("latin1"), "PNG", `${file}: PNG değil`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

// ── 1. Tek tanım: yayıncı ve kurum-yazar düğümü ────────────────────────────
{
  const publisher = publisherNode();
  assert.equal(publisher["@type"], "Organization");
  assert.equal(publisher.name, PUBLICATION_NAME);
  assert.equal(publisher.url, `${SITE_URL}/`);
  assert.equal(publisher.logo["@type"], "ImageObject");
  assert.equal(publisher.logo.url, PUBLISHER_LOGO.url);
  const logoFile = localFile(publisher.logo.url);
  assert.ok(logoFile && fs.existsSync(logoFile), `yayıncı logosu depoda yok: ${publisher.logo.url}`);
  assert.deepEqual(pngSize(logoFile), { width: publisher.logo.width, height: publisher.logo.height }, "bildirilen logo boyutu gerçek dosyayla aynı olmalı");
  assert.notEqual(publisher.logo.url, DEFAULT_ARTICLE_IMAGE, "logo, paylaşım kartı (og-image) olmamalı");
  assert.notEqual(publisherNode(), publisherNode(), "her çağrı yeni nesne döndürmeli (üreticiler düğümü değiştirebilir)");

  const author = organizationAuthorNode();
  assert.deepEqual(author, { "@type": "Organization", name: PUBLICATION_NAME, url: `${SITE_URL}/` });
  assert.equal(organizationAuthorNode(`${SITE_URL}/yazarlar/futbolradar.html`).url, `${SITE_URL}/yazarlar/futbolradar.html`);

  const imageFile = localFile(DEFAULT_ARTICLE_IMAGE);
  assert.ok(imageFile && fs.existsSync(imageFile), "varsayılan haber görseli depoda yok");
  assert.deepEqual(pngSize(imageFile), { width: 1200, height: 630 }, "varsayılan haber görseli 1200×630 olmalı");
  console.log(`  ok  yayıncı düğümü: ${PUBLICATION_NAME}, logo ${publisher.logo.width}×${publisher.logo.height} (dosyayla aynı), varsayılan görsel 1200×630`);
}

// ── 2. Canlı maç haberi (sunucusuz işlev): şeması aynı tanımı kullanır ──────
{
  const matchNews = require("../services/matchNews.js");
  const node = matchNews.schema(matchNews.view(null));
  for (const field of REQUIRED) assert.ok(filled(node[field]), `canlı maç haberi: NewsArticle.${field} yok`);
  assert.deepEqual(node.publisher, publisherNode(), "canlı maç haberi: yayıncı tek tanımdan gelmeli");
  assert.deepEqual(node.author, organizationAuthorNode(), "canlı maç haberi: yazar tek tanımdan gelmeli");
  assert.equal(node.mainEntityOfPage, matchNews.URL);
  console.log("  ok  canlı maç haberi (services/matchNews.js): yedi alan dolu, yayıncı/yazar tek tanımdan");
}

// ── 3. Diskteki her haber ve köşe yazısı sayfası ───────────────────────────
function newsArticles(html) {
  const out = [];
  let parseError = null;
  for (const [, body] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed;
    try { parsed = JSON.parse(body); } catch (error) { parseError = error.message; continue; }
    for (const block of [].concat(parsed)) {
      for (const node of [].concat(block && block["@graph"] ? block["@graph"] : block)) {
        if (node && [].concat(node["@type"] || []).includes("NewsArticle")) out.push(node);
      }
    }
  }
  return { nodes: out, parseError };
}

const problems = new Map(); // mesaj → { count, sample }
const fail = (rel, message) => {
  const entry = problems.get(message) || { count: 0, sample: rel };
  entry.count += 1;
  problems.set(message, entry);
};
const counts = {};

for (const section of SECTIONS) {
  const dir = path.join(root, section);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".html")).sort() : [];
  assert.ok(files.length > 0, `${section}/: sayfa yok`);
  counts[section] = files.length;
  for (const name of files) {
    const rel = `${section}/${name}`;
    const html = fs.readFileSync(path.join(dir, name), "utf8");
    const { nodes, parseError } = newsArticles(html);
    if (parseError) fail(rel, `JSON-LD ayrıştırılamıyor`);
    if (nodes.length !== 1) { fail(rel, `NewsArticle düğümü ${nodes.length} adet (tam 1 olmalı)`); continue; }
    const node = nodes[0];

    for (const field of REQUIRED) if (!filled(node[field])) fail(rel, `${field} yok`);

    if (filled(node.datePublished) && !ISO_WITH_ZONE.test(node.datePublished)) fail(rel, "datePublished ISO 8601 + saat dilimi değil");
    if (filled(node.dateModified) && !ISO_WITH_ZONE.test(node.dateModified)) fail(rel, "dateModified ISO 8601 + saat dilimi değil");
    if (Date.parse(node.dateModified) < Date.parse(node.datePublished)) fail(rel, "dateModified, datePublished'dan önce");

    const author = node.author;
    if (filled(author)) {
      if (Array.isArray(author) || typeof author !== "object") fail(rel, "author tek bir nesne olmalı");
      else {
        if (!filled(author.name)) fail(rel, "author.name yok");
        if (HOUSE_AUTHOR_ONLY && (author["@type"] !== "Organization" || author.name !== PUBLICATION_NAME)) fail(rel, `author yayının kendisi değil (Organization / ${PUBLICATION_NAME})`);
      }
    }

    const publisher = node.publisher;
    if (filled(publisher)) {
      if (publisher["@type"] !== "Organization" || publisher.name !== PUBLICATION_NAME) fail(rel, `publisher ${PUBLICATION_NAME} kurumu değil`);
      const logoUrl = publisher.logo && typeof publisher.logo === "object" ? publisher.logo.url : publisher.logo;
      if (!filled(logoUrl)) fail(rel, "publisher.logo yok");
      else {
        const file = localFile(logoUrl);
        if (!file) fail(rel, "publisher.logo site içi mutlak adres değil");
        else if (!fs.existsSync(file)) fail(rel, "publisher.logo dosyası depoda yok");
      }
    }

    for (const image of [].concat(node.image || [])) {
      const url = image && typeof image === "object" ? image.url : image;
      const file = localFile(url);
      if (!file) fail(rel, "image site içi mutlak adres değil");
      else if (!fs.existsSync(file)) fail(rel, "image dosyası depoda yok");
    }

    const canonical = (/<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(html) || [])[1] || "";
    const main = node.mainEntityOfPage && typeof node.mainEntityOfPage === "object" ? node.mainEntityOfPage["@id"] : node.mainEntityOfPage;
    if (filled(main) && main !== canonical) fail(rel, "mainEntityOfPage sayfanın canonical adresi değil");
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const lines = [...problems.entries()].sort((a, b) => b[1].count - a[1].count).map(([message, entry]) => `  ${entry.count}× ${message}\n      örnek: ${entry.sample}`);
assert.equal(problems.size, 0, `NewsArticle eksikleri (${[...problems.values()].reduce((a, b) => a + b.count, 0)} bulgu, ${total} sayfa):\n${lines.join("\n")}`);
console.log(`  ok  ${total} sayfa (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ")}): NewsArticle yedi alanı dolu; tarih, yazar, yayıncı+logo, görsel ve canonical tutarlı`);
console.log("news-article-schema: tamam");
