#!/usr/bin/env node
/**
 * GOOGLE DISCOVER GÖRSEL KAPISI — haber ve köşe yazısı sayfaları.
 *
 * Discover bir sayfayı öne çıkarmak için üç şey arar; üçünün de sessizce
 * bozulması mümkündür (sayfa açılır, hata vermez, yalnızca akışa girmez):
 *
 *   1. `max-image-preview:large` robots yönergesi,
 *   2. en az 1200 piksel genişliğinde, sayfaya özgü bir görsel
 *      (og:image + yapısal veri `image` + sayfa içi görsel aynı dosya),
 *   3. görünür yayın ve güncelleme tarihleri (yapısal veriyle aynı değer).
 *
 * Sayfalar derleme ürünüdür (Vercel `generate-news-pages` /
 * `generate-column-pages` koşturur), bu yüzden test depodaki eski çıktıya
 * değil ÜRETİCİNİN BUGÜNKÜ ŞABLONUNA bakar: köşe yazısı süreç içinde,
 * haber sayfası geçici bir kökte çizilir. Depoya hiçbir sayfa yazılmaz.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  COVER_DIR, COVER_DOMAIN, COVER_HEIGHT, COVER_WIDTH, coverExists, coverRelPath,
  isGenericImage, newsCoverSlug, readJpegSize
} from "./lib/coverImages.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { CARD_HEIGHT, CARD_WIDTH, renderCoverJpeg, wrapLines } from "./lib/coverRender.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const { publishableNews } = require("../services/newsFeed.js");
const { isThinAutomatedNews } = require("../services/newsIndexPolicy.js");
const { publishedColumns } = require("../services/columnService.js");
const { columnPageHtml } = await import("./generate-column-pages.mjs");

function imageSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(1, 4).toString("ascii") === "PNG") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  const jpeg = readJpegSize(file);
  assert.ok(jpeg, `${file}: PNG ya da JPEG değil`);
  return jpeg;
}

const meta = (html, re) => (html.match(re) || [])[1];
const content = (html, attr, name) =>
  meta(html, new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`, "i"));
const jsonLdBlocks = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const articleLd = (html) => {
  for (const block of jsonLdBlocks(html)) {
    const nodes = Array.isArray(block["@graph"]) ? block["@graph"] : [block];
    const found = nodes.find((n) => n["@type"] === "NewsArticle");
    if (found) return found;
  }
  throw new Error("NewsArticle yapısal verisi yok");
};
const ldImageUrl = (image) => (typeof image === "string" ? image : image && image.url);

/** Bir sayfanın Discover sözleşmesini doğrular; kapak beklenen mi bilgisi dışarıdan gelir. */
function assertDiscoverPage(label, html, { expectCover, pageRoot, pageDir }) {
  assert.equal(content(html, "name", "robots"), ROBOTS_INDEX, `${label}: robots indekslenebilir sayfa yönergesi değil`);
  assert.match(content(html, "name", "robots"), /max-image-preview:large/, `${label}: max-image-preview:large yok`);

  const og = content(html, "property", "og:image");
  const tw = content(html, "name", "twitter:image");
  const ld = articleLd(html);
  assert.equal(tw, og, `${label}: twitter:image ile og:image farklı`);
  assert.equal(ldImageUrl(ld.image), og, `${label}: yapısal veri image ile og:image farklı`);
  assert.ok(og.startsWith(`${COVER_DOMAIN}/`), `${label}: og:image kendi alan adında değil`);
  const rel = og.slice(COVER_DOMAIN.length + 1);
  assert.ok(fs.existsSync(path.join(root, rel)), `${label}: og:image dosyası diskte yok (${rel})`);
  const size = imageSize(path.join(root, rel));
  assert.ok(size.width >= 1200, `${label}: görsel ${size.width}px, en az 1200 olmalı`);
  const declaredW = content(html, "property", "og:image:width");
  const declaredH = content(html, "property", "og:image:height");
  if (declaredW || declaredH) {
    assert.equal(`${declaredW}x${declaredH}`, `${size.width}x${size.height}`, `${label}: bildirilen ölçü dosyayla uyuşmuyor`);
  }

  const figure = meta(html, /<figure class="column-featured-image"><img src="([^"]+)"/);
  if (expectCover) {
    assert.ok(rel.startsWith(`${COVER_DIR}/`), `${label}: sayfaya özel kapak beklenirdi, ${rel} bulundu`);
    assert.equal(ldImageUrl(ld.image), og);
    assert.equal(ld.image.width, COVER_WIDTH, `${label}: ImageObject genişliği`);
    assert.equal(ld.image.height, COVER_HEIGHT, `${label}: ImageObject yüksekliği`);
    assert.ok(figure, `${label}: sayfa içi öne çıkan görsel yok`);
    const resolved = path.normalize(path.join(pageDir, figure));
    assert.equal(resolved, path.join(pageRoot, rel), `${label}: sayfa içi görsel og:image dosyasından farklı`);
    assert.match(html, /<figure class="column-featured-image"><img [^>]*width="1200" height="630"[^>]*alt="[^"]+"/, `${label}: görselde ölçü/alt yok`);
  }

  // Görünür tarihler yapısal veriyle AYNI değeri taşır.
  const times = [...html.matchAll(/<time datetime="([^"]*)">([^<]*)<\/time>/g)].map((m) => ({ iso: m[1], text: m[2] }));
  const published = times.find((t) => /^(Yayın|Published): /.test(t.text));
  const updated = times.find((t) => /^(Güncelleme|Updated): /.test(t.text) && t.iso === ld.dateModified);
  assert.ok(published, `${label}: görünür "Yayın" tarihi yok`);
  assert.equal(published.iso, ld.datePublished, `${label}: görünür yayın tarihi ile datePublished farklı`);
  assert.ok(updated, `${label}: görünür "Güncelleme" tarihi yok ya da dateModified ile uyuşmuyor`);
  assert.ok(!Number.isNaN(Date.parse(updated.iso)) && !Number.isNaN(Date.parse(published.iso)), `${label}: tarih ayrıştırılamıyor`);
}

// ── 1. KAPAK DOSYALARI ─────────────────────────────────────────────────────
const coverRoot = path.join(root, COVER_DIR);
const manifest = JSON.parse(fs.readFileSync(path.join(coverRoot, "manifest.json"), "utf8"));
let coverFiles = 0;
for (const kind of fs.readdirSync(coverRoot, { withFileTypes: true }).filter((e) => e.isDirectory())) {
  for (const file of fs.readdirSync(path.join(coverRoot, kind.name))) {
    const rel = `${COVER_DIR}/${kind.name}/${file}`;
    const full = path.join(root, rel);
    const size = readJpegSize(full);
    assert.ok(size, `${rel}: JPEG değil`);
    assert.ok(size.width >= 1200, `${rel}: ${size.width}px, en az 1200 olmalı`);
    assert.equal(`${size.width}x${size.height}`, `${COVER_WIDTH}x${COVER_HEIGHT}`, `${rel}: beklenen ölçü dışında`);
    assert.ok(fs.statSync(full).size <= 150 * 1024, `${rel}: 150 KB üstünde`);
    assert.ok(manifest[rel], `${rel}: manifestte kaydı yok (üreticiyi çalıştırın)`);
    coverFiles += 1;
  }
}
for (const rel of Object.keys(manifest)) assert.ok(coverExists(rel), `manifestte olup diskte olmayan kapak: ${rel}`);

// ── 2. KAPSAM (bilgi amaçlı: yeni haber üretici koşusu kapaksız gelebilir) ──
const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
const indexableNews = publishableNews(news).filter((a) => !isThinAutomatedNews(a));
const coveredNews = indexableNews.filter((a) => coverExists(coverRelPath("haber", newsCoverSlug(a))));
const { columns } = publishedColumns(JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8")), { locale: "tr" });
const genericColumns = columns.filter((c) => isGenericImage(c.featuredImage));
const coveredColumns = genericColumns.filter((c) => coverExists(coverRelPath("kose", path.basename(c.path, ".html"))));

// ── 3. KÖŞE YAZISI ŞABLONU ─────────────────────────────────────────────────
const withCover = coveredColumns[0];
assert.ok(withCover, "kapaklı köşe yazısı bulunamadı");
assertDiscoverPage(`köşe yazısı ${withCover.path}`, columnPageHtml(withCover, "tr"), {
  expectCover: true, pageRoot: root, pageDir: path.join(root, "kose-yazilari")
});
const ownImage = columns.find((c) => !isGenericImage(c.featuredImage));
if (ownImage) {
  // Kendi görseli olan yazı kapakla DEĞİŞTİRİLMEZ.
  const html = columnPageHtml(ownImage, "tr");
  assert.ok(!content(html, "property", "og:image").includes(`/${COVER_DIR}/`), `${ownImage.path}: kendi görseli kapakla ezildi`);
}

// ── 4. HABER ŞABLONU (geçici kökte) ────────────────────────────────────────
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "fr-cover-test-"));
try {
  fs.mkdirSync(path.join(sandbox, "data"), { recursive: true });
  fs.copyFileSync(path.join(root, "data", "news.json"), path.join(sandbox, "data", "news.json"));
  fs.mkdirSync(path.join(sandbox, "assets"), { recursive: true });
  fs.symlinkSync(coverRoot, path.join(sandbox, COVER_DIR), "dir");
  fs.copyFileSync(path.join(root, "assets", "og-image.png"), path.join(sandbox, "assets", "og-image.png"));

  const thin = publishableNews(news).find((a) => isThinAutomatedNews(a));
  const picks = [indexableNews.find((a) => coverExists(coverRelPath("haber", newsCoverSlug(a)))), thin].filter(Boolean);
  assert.ok(picks.length === 2, "haber örnekleri bulunamadı (kapaklı indekslenebilir + ince)");
  for (const article of picks) {
    const run = spawnSync(process.execPath, [path.join(scriptsDir, "generate-news-pages.mjs"), `--id=${article.id}`], {
      cwd: sandbox, encoding: "utf8"
    });
    assert.equal(run.status, 0, `haber üretici başarısız: ${run.stderr || run.stdout}`);
    const slug = newsCoverSlug(article);
    const html = fs.readFileSync(path.join(sandbox, "haber", `${slug}.html`), "utf8");
    if (isThinAutomatedNews(article)) {
      // İnce otomatik haber indekslenmez: Discover'a girmez, kapak üretilmez.
      assert.equal(content(html, "name", "robots"), ROBOTS_NOINDEX_FOLLOW);
      assert.equal(content(html, "property", "og:image"), `${COVER_DOMAIN}/assets/og-image.png`, "ince haber ortak görselde kalmalı");
      assert.ok(!html.includes('class="column-featured-image"'));
    } else {
      assertDiscoverPage(`haber ${slug}`, html, { expectCover: true, pageRoot: sandbox, pageDir: path.join(sandbox, "haber") });
    }
  }
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

// ── 4b. YENİ HABER DERLEMEDE KAPAK ALIR ─────────────────────────────────────
// Depoda kapağı olmayan yeni bir haber: `generate-cover-images.mjs --soft`
// (derlemedeki adım) kapağı çizer, ardından haber üreticisi onu bildirir.
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "fr-cover-fresh-"));
try {
  fs.mkdirSync(path.join(fresh, "data"), { recursive: true });
  fs.mkdirSync(path.join(fresh, "assets"), { recursive: true });
  fs.cpSync(coverRoot, path.join(fresh, COVER_DIR), { recursive: true });
  fs.copyFileSync(path.join(root, "assets", "og-image.png"), path.join(fresh, "assets", "og-image.png"));
  fs.copyFileSync(path.join(root, "data", "columns.json"), path.join(fresh, "data", "columns.json"));
  const template = indexableNews[0];
  const freshId = "yeni-deneme-haberi-kapak-testi";
  fs.writeFileSync(path.join(fresh, "data", "news.json"), JSON.stringify([
    ...news,
    { ...template, id: freshId, slug: freshId, title: "Yeni deneme haberi: kapak derlemede çizilmeli", publishedAt: "2099-01-01T09:00:00+03:00", updatedAt: "2099-01-01T09:00:00+03:00" }
  ]));
  const cover = spawnSync(process.execPath, [path.join(scriptsDir, "generate-cover-images.mjs"), "--soft"], { cwd: fresh, encoding: "utf8" });
  assert.equal(cover.status, 0, `kapak adımı başarısız: ${cover.stderr || cover.stdout}`);
  assert.match(cover.stdout, /1 kapak yazıldı/, `yalnızca yeni haberin kapağı çizilmeli: ${cover.stdout}`);
  const freshCover = path.join(fresh, coverRelPath("haber", freshId));
  assert.ok(fs.existsSync(freshCover), "yeni haberin kapağı çizilmedi");
  assert.deepEqual(readJpegSize(freshCover), { width: COVER_WIDTH, height: COVER_HEIGHT });
  const page = spawnSync(process.execPath, [path.join(scriptsDir, "generate-news-pages.mjs"), `--id=${freshId}`], { cwd: fresh, encoding: "utf8" });
  assert.equal(page.status, 0, `haber üretici başarısız: ${page.stderr || page.stdout}`);
  const html = fs.readFileSync(path.join(fresh, "haber", `${freshId}.html`), "utf8");
  assert.equal(content(html, "property", "og:image"), `${COVER_DOMAIN}/${coverRelPath("haber", freshId)}`, "yeni haber kapağını bildirmeli");
  // İkinci koşu iş yapmamalı (manifest güncel).
  const again = spawnSync(process.execPath, [path.join(scriptsDir, "generate-cover-images.mjs"), "--soft"], { cwd: fresh, encoding: "utf8" });
  assert.match(again.stdout, /yapılacak iş yok/);
} finally {
  fs.rmSync(fresh, { recursive: true, force: true });
}

// ── 5. ÇİZİCİ VE DERLEME BAĞI ──────────────────────────────────────────────
// Çizici tarayıcısız çalışır; uç durumlar (çok uzun başlık, Türkçe harfler,
// boş bölüm) kırılmadan 1200×630 JPEG vermeli.
const edgeCards = [
  { kicker: "Köşe yazısı", sub: "", title: "İşçi şöförün öğrenci ığdır çağrışım ŞÜĞÖÇİ", date: "24 Kasım 2026" },
  { kicker: "Haber", sub: "Fenerbahçe", title: "Uzun ".repeat(60).trim(), date: "" },
  { kicker: "Haber", sub: "Galatasaray", title: "Tek", date: "1 Ocak 2027" }
];
for (const card of edgeCards) {
  const jpg = renderCoverJpeg(card);
  const probe = path.join(os.tmpdir(), `fr-cover-edge-${process.pid}.jpg`);
  fs.writeFileSync(probe, jpg);
  const size = readJpegSize(probe);
  fs.rmSync(probe, { force: true });
  assert.deepEqual(size, { width: CARD_WIDTH, height: CARD_HEIGHT }, `çizici beklenen ölçüyü vermedi: ${card.title.slice(0, 20)}`);
}
const wrapped = wrapLines("Uzun ".repeat(60).trim(), 40, 800, 972, 4);
assert.equal(wrapped.length, 4, "başlık 4 satırla sınırlı olmalı");
assert.ok(wrapped[3].endsWith("…"), "sığmayan başlık '…' ile bitmeli");

// Derleme, sayfa üreticilerinden ÖNCE kapak adımını koşturmalı; adım --soft
// olmalı ki çizici sorunu dağıtımı durdurmasın.
const build = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts.build;
const coverStep = build.indexOf("generate-cover-images.mjs --soft");
assert.ok(coverStep >= 0, "npm run build kapak adımını --soft ile içermeli");
assert.ok(coverStep < build.indexOf("generate-column-pages.mjs"), "kapak adımı köşe yazısı üreticisinden önce olmalı");
assert.ok(coverStep < build.indexOf("generate-news-pages.mjs"), "kapak adımı haber üreticisinden önce olmalı");

console.log(
  `cover-images: ${coverFiles} kapak dosyası geçerli (≥1200 px, ${COVER_WIDTH}×${COVER_HEIGHT}); ` +
  `haber kapsamı ${coveredNews.length}/${indexableNews.length}, köşe yazısı kapsamı ${coveredColumns.length}/${genericColumns.length}; ` +
  `robots/görsel/tarih şablon denetimleri geçti.`
);
