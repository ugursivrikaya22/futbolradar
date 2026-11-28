#!/usr/bin/env node
/**
 * GOOGLE DISCOVER UYUMU — haber ve köşe yazısı sayfaları.
 *
 * Kural: scripts/lib/discoverMedia.mjs. Bu test hem dönüşümün kendisini
 * (birim) hem de yayınlanan ağacı (kök + `public/` aynası) denetler:
 *
 *   1. `max-image-preview:large` her sayfanın <head>'inde; mevcut
 *      index/noindex yönergesi DEĞİŞMEMİŞ.
 *   2. og:image / twitter:image / JSON-LD image AYNI dosyayı gösteriyor;
 *      dosya diskte, JPEG, en az 1200 px ve tam 16:9.
 *   3. NewsArticle/Article: headline, datePublished, dateModified, author,
 *      publisher (+ logo) eksiksiz.
 *   4. Gövdede tek öne çıkan görsel: öncelikli (eager + fetchpriority=high),
 *      ölçülü (width/height → CLS yok); diğer gövde görselleri tembel.
 *   5. Dönüşüm idempotent: yayınlanan sayfada ikinci koşu sıfır değişiklik.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ARTICLE_SECTIONS,
  DISCOVER_HEIGHT,
  DISCOVER_WIDTH,
  DOMAIN,
  applyDiscoverMedia,
  articleImagePath,
  isIndexable,
  listArticlePages,
  smallVariantPath,
  topicImageJobs
} from "./lib/discoverMedia.mjs";

const root = process.cwd();
console.log("discover-media");

function jpegSize(file) {
  const buf = fs.readFileSync(file);
  assert.ok(buf[0] === 0xff && buf[1] === 0xd8, `${file}: JPEG değil`);
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) { pos += 1; continue; }
    const marker = buf[pos + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
    const len = buf.readUInt16BE(pos + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7), bytes: buf.length };
    }
    pos += 2 + len;
  }
  throw new Error(`${file}: JPEG ölçüsü okunamadı`);
}

function ldNodes(head) {
  const nodes = [];
  for (const match of head.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const data = JSON.parse(match[1]);
    nodes.push(...(Array.isArray(data) ? data : data["@graph"] || [data]));
  }
  return nodes;
}

const isArticle = (node) => [].concat(node["@type"] || []).some((t) => /Article|BlogPosting/.test(t));

// ── 1. Birim: dönüşüm ──────────────────────────────────────────────────────
{
  const section = ARTICLE_SECTIONS[0];
  const page = { relative: "haber/ornek-yok.html", section, slug: "ornek-yok" };
  const fixture = `<!doctype html><html><head>
    <title>Örnek | FutbolRadar</title>
    <link rel="canonical" href="${DOMAIN}/haber/ornek-yok" />
    <meta name="robots" content="noindex,follow" />
    <meta property="og:description" content="x" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:description" content="x" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Örnek başlık","datePublished":"2026-11-01T10:00:00+03:00","publisher":{"@type":"Organization","name":"FutbolRadar","logo":{"@type":"ImageObject","url":"${DOMAIN}/assets/og-image.png"}}}</script>
  </head><body><main><article class="column-article"><header class="column-article-head"><span class="column-tag">Galatasaray</span><h1>Örnek başlık</h1></header>
  <div class="column-body"><p>Metin</p><img src="/x.png" alt="x" /></div></article></main></body></html>`;

  const first = applyDiscoverMedia(fixture, { root, page });
  const out = first.html;
  assert.ok(first.changed, "uyumsuz sayfa değişmeli");
  assert.match(out, /<meta name="robots" content="noindex,follow" \/>/, "mevcut noindex yönergesi korunmalı");
  assert.match(out, /<meta name="robots" content="max-image-preview:large" \/>/, "büyük önizleme izni eklenmeli");
  assert.match(out, /og:image" content="https:\/\/www\.futbolradar\.com\/assets\/discover\/konu\/galatasaray\.jpg"/, "kartı olmayan sayfa konu kartını kullanmalı");
  assert.match(out, /og:image:width" content="1200"/);
  assert.match(out, /og:image:height" content="675"/);
  assert.match(out, /twitter:image" content="https:\/\/www\.futbolradar\.com\/assets\/discover\/konu\/galatasaray\.jpg"/);
  const [node] = ldNodes(out.split("</head>")[0]);
  assert.equal(node.headline, "Örnek başlık", "headline değişmemeli");
  assert.equal(node.dateModified, node.datePublished, "eksik dateModified datePublished ile tamamlanmalı");
  assert.equal(node.author.name, "FutbolRadar", "eksik yazar markayla tamamlanmalı");
  assert.equal(node.publisher.logo.url, `${DOMAIN}/favicon-512x512.png`, "publisher.logo gerçek logo olmalı");
  assert.equal(node.image.url, `${DOMAIN}/assets/discover/konu/galatasaray.jpg`);
  assert.match(out, /<\/header>\n?\s*<figure class="column-featured-image"><img src="\/assets\/discover\/konu\/galatasaray\.jpg" srcset="\/assets\/discover\/konu\/galatasaray-768\.webp 768w, \/assets\/discover\/konu\/galatasaray\.jpg 1200w" sizes="[^"]+" alt="Örnek başlık" width="1200" height="675" loading="eager" fetchpriority="high"/, "öne çıkan görsel başlık bloğunun ardına, öncelikli ve duyarlı gelmeli");
  assert.match(out, /<img loading="lazy" decoding="async" src="\/x\.png"/, "diğer gövde görselleri tembel yüklenmeli");
  assert.equal(applyDiscoverMedia(out, { root, page }).changed, false, "dönüşüm idempotent olmalı");

  // Var olan yazar (kişi) ve başlık KORUNUR; mevcut kapak figürü yeniden kullanılır.
  const person = fixture
    .replace('"headline":"Örnek başlık"', '"headline":"Örnek başlık","author":{"@type":"Person","name":"Yazar"}')
    .replace('<div class="column-body">', '<figure class="column-featured-image"><img src="../assets/og-image.svg" alt="Kapak" loading="eager" /></figure><div class="column-body">');
  const personOut = applyDiscoverMedia(person, { root, page }).html;
  assert.equal(ldNodes(personOut.split("</head>")[0])[0].author.name, "Yazar", "kişi yazar korunmalı");
  assert.equal((personOut.match(/column-featured-image/g) || []).length, 1, "ikinci figür eklenmemeli");
  assert.match(personOut, /alt="Kapak" width="1200" height="675" loading="eager" fetchpriority="high"/, "mevcut kapak alt metni korunmalı");
}

// ── 2. Konu kartları ──────────────────────────────────────────────────────
for (const job of topicImageJobs()) {
  const file = path.join(root, job.file);
  assert.ok(fs.existsSync(file), `${job.file} üretilmeli (node scripts/generate-discover-images.mjs)`);
  const { width, height } = jpegSize(file);
  assert.equal(`${width}x${height}`, `${DISCOVER_WIDTH}x${DISCOVER_HEIGHT}`, `${job.file}: ölçü`);
  assert.ok(fs.existsSync(path.join(root, "public", job.file)), `public/${job.file} eksik`);
  const small = path.join(root, smallVariantPath(job.file));
  assert.ok(fs.existsSync(small) && fs.readFileSync(small).slice(8, 12).toString("ascii") === "WEBP", `${smallVariantPath(job.file)}: küçük WebP varyantı eksik`);
}

// ── 3. Yayınlanan sayfalar ────────────────────────────────────────────────
const problems = [];
const sizes = new Map();
let pages = 0;
let withOwnCard = 0;
const indexableWithoutCard = [];

for (const page of listArticlePages(root)) {
  pages += 1;
  const html = fs.readFileSync(path.join(root, page.relative), "utf8");
  const fail = (message) => problems.push(`${page.relative}: ${message}`);
  const head = html.split(/<\/head>/i)[0];
  const body = html.slice(head.length);

  if (applyDiscoverMedia(html, { root, page }).changed) fail("discover dönüşümü uygulanmamış (node scripts/inject-discover-media.mjs)");
  if (!/<meta\s+name="robots"\s+content="[^"]*max-image-preview:large/i.test(head)) fail("max-image-preview:large yok");

  const og = (head.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || "";
  const tw = (head.match(/<meta name="twitter:image" content="([^"]+)"/) || [])[1] || "";
  const ogW = (head.match(/<meta property="og:image:width" content="(\d+)"/) || [])[1];
  const ogH = (head.match(/<meta property="og:image:height" content="(\d+)"/) || [])[1];
  if (!og.startsWith(`${DOMAIN}/assets/discover/`)) { fail(`og:image Discover görseli değil: ${og}`); continue; }
  if (tw !== og) fail("twitter:image og:image ile aynı değil");
  const relative = og.slice(DOMAIN.length + 1);
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { fail(`görsel diskte yok: ${relative}`); continue; }
  if (!sizes.has(relative)) sizes.set(relative, jpegSize(file));
  const { width, height } = sizes.get(relative);
  if (width < 1200 || width * 9 !== height * 16) fail(`görsel 16:9 ve ≥1200 px değil (${width}×${height})`);
  if (String(width) !== ogW || String(height) !== ogH) fail(`og:image ölçüsü dosyayla uyuşmuyor (${ogW}×${ogH})`);
  if (relative === articleImagePath(page.section, page.slug)) withOwnCard += 1;
  else if (!page.relative.startsWith("public/") && isIndexable(html)) indexableWithoutCard.push(page.relative);

  const articles = ldNodes(head).filter(isArticle);
  if (!articles.length) fail("NewsArticle/Article JSON-LD yok");
  for (const node of articles) {
    for (const key of ["headline", "datePublished", "dateModified"]) if (!node[key]) fail(`JSON-LD ${key} yok`);
    if (![].concat(node.author || []).every((a) => a && a.name)) fail("JSON-LD author eksik");
    if (!node.publisher || !node.publisher.name || !node.publisher.logo || !node.publisher.logo.url) fail("JSON-LD publisher/logo eksik");
    const image = [].concat(node.image || [])[0];
    if (!image || (image.url || image) !== og) fail("JSON-LD image og:image ile aynı değil");
  }

  const figures = body.match(/<figure class="column-featured-image">[\s\S]*?<\/figure>/g) || [];
  if (figures.length !== 1) { fail(`öne çıkan görsel sayısı ${figures.length}`); continue; }
  const img = (figures[0].match(/<img\b[^>]*>/) || [""])[0];
  if (!img.includes(`src="/${relative}"`)) fail("gövde görseli og:image ile aynı dosya değil");
  if (!/loading="eager"/.test(img) || !/fetchpriority="high"/.test(img)) fail("öne çıkan görsel öncelikli değil");
  if (!/width="\d+" height="\d+"/.test(img)) fail("öne çıkan görselde width/height yok (CLS)");
  const small = smallVariantPath(relative);
  if (!fs.existsSync(path.join(root, small))) fail(`küçük varyant yok: ${small}`);
  else if (!img.includes(`srcset="/${small} 768w, /${relative} 1200w"`) || !/\ssizes="/.test(img)) fail("öne çıkan görselde srcset/sizes yok");
  const firstImg = (body.match(/<img\b[^>]*>/) || [""])[0];
  if (firstImg !== img) fail("öne çıkan görsel sayfanın ilk görseli değil");
  const others = (body.match(/<img\b[^>]*>/g) || []).filter((tag) => tag !== img);
  if (others.some((tag) => !/loading="lazy"/.test(tag))) fail("öne çıkan görsel dışındaki görseller tembel değil");
}

const show = (list) => list.slice(0, 8).join("\n    ") + (list.length > 8 ? `\n    … +${list.length - 8}` : "");
assert.equal(problems.length, 0, `Discover uyumsuzluğu:\n    ${show(problems)}`);
if (indexableWithoutCard.length) {
  // Hata değil: yeni haber, kartı üretilene kadar konu kartıyla (yine 16:9) yayınlanır.
  console.log(`  uyarı: ${indexableWithoutCard.length} indekslenebilir sayfa konu kartı kullanıyor — node scripts/generate-discover-images.mjs\n    ${show(indexableWithoutCard)}`);
}
console.log(`Discover: ${pages} sayfa (kök + public) — hepsi 16:9 ≥1200 px görsel, max-image-preview:large, eksiksiz NewsArticle; ${withOwnCard} sayfa kendi kartıyla.`);
