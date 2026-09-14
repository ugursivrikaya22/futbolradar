#!/usr/bin/env node
/**
 * PAYLAŞIM GÖRSELİ DENETİMİ — kap, ölçü, boyut ve bildirim tutarlılığı.
 *
 * Bu testin var olma sebebi, yakaladığı hatanın SESSİZ olması. `og:image`
 * olarak SVG bildiren bir sayfa hiçbir denetimden düşmez: bildirim geçerli,
 * dosya yerinde, bağlantı çalışıyor. Yalnızca X, Facebook, WhatsApp ve
 * Telegram önizleme üretemez ve paylaşılan bağlantı görselsiz çıkar. Geri
 * bildirim yok — kimse fark etmez.
 *
 * Bu yüzden burada bildirimin KENDİSİ değil, bildirilen DOSYA denetleniyor:
 * gerçekten PNG mi, gerçekten 1200×630 mü, sayfanın yazdığı
 * `og:image:width`/`height` o dosyayla uyuşuyor mu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";
const MAX_BYTES = 300 * 1024;

/** PNG başlığından ölçü ve kap. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.slice(1, 4).toString("ascii"), "PNG", `${file}: PNG imzası yok`);
  assert.equal(buf.toString("ascii", 12, 16), "IHDR", `${file}: IHDR ilk yığın değil`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

/**
 * Herhangi bir raster kaptan ölçü.
 *
 * JPEG de destekleniyor çünkü köşe yazılarının biri (`assets/columns/
 * avrupa-gecesinde-sari-lacivert-imza.jpg`) fotoğraf kapağı kullanıyor ve
 * JPEG sosyal ağlarda SORUNSUZ önizleniyor — sorun yalnızca SVG'de.
 * Ölçü çapraz denetimi o sayfa için de anlamlı olsun diye kap başına
 * okuyucu var; bilinmeyen kap AÇIKÇA reddediliyor, sessizce atlanmıyor.
 */
function readImageSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(1, 4).toString("ascii") === "PNG") {
    return { ...readPng(file), kind: "png" };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // JPEG: SOF0/1/2/3/5/6/7/9/10/11/13/14/15 işaretçisinde ölçü var.
    let pos = 2;
    while (pos + 9 < buf.length) {
      if (buf[pos] !== 0xff) { pos += 1; continue; }
      const marker = buf[pos + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      const len = buf.readUInt16BE(pos + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7), bytes: buf.length, kind: "jpeg" };
      }
      pos += 2 + len;
    }
    throw new Error(`${file}: JPEG içinde SOF işaretçisi bulunamadı`);
  }
  throw new Error(`${file}: desteklenmeyen paylaşım görseli kabı (PNG ya da JPEG bekleniyor)`);
}

// ── 1. Üretilmiş görseller: kap, ölçü, boyut ve kök/public eşliği ──────────
const EXPECTED = [
  "assets/og-image.png",
  "assets/columns/kasimpasa-trabzonspor-cevap-verme-vakti.png",
  "assets/columns/osimhen-galatasaray-sampiyonluk-sinyalleri-taktik-analiz.png"
];

for (const relative of EXPECTED) {
  const file = path.join(root, relative);
  assert.ok(fs.existsSync(file), `${relative} üretilmeli`);
  const { width, height, bytes } = readPng(file);
  assert.equal(width, 1200, `${relative}: genişlik 1200 olmalı`);
  assert.equal(height, 630, `${relative}: yükseklik 630 olmalı`);
  assert.ok(bytes < MAX_BYTES, `${relative}: ${(bytes / 1024).toFixed(1)} KB — ${MAX_BYTES / 1024} KB sınırını aşıyor`);

  // `public/` kök ağacın aynası; paylaşım görseli ikisinde de aynı olmalı.
  const mirror = path.join(root, "public", relative);
  assert.ok(fs.existsSync(mirror), `public/${relative} eksik`);
  assert.equal(Buffer.compare(fs.readFileSync(file), fs.readFileSync(mirror)), 0,
    `public/${relative} kök kopyayla aynı değil`);
}

// Kaynak SVG SİLİNMEDİ: PNG ondan üretiliyor, tasarımın kaynağı o.
for (const relative of ["assets/og-image.svg"]) {
  assert.ok(fs.existsSync(path.join(root, relative)), `${relative} korunmalı (PNG'nin kaynağı)`);
}

// ── 2. Sayfalar: hiçbir paylaşım bildirimi SVG göstermemeli ───────────────
const SKIP_DIRS = new Set([".git", ".vercel", "node_modules", "scripts", "services", "server",
  "api", "docs", "lib", "components", "editorial", "locales", "data", "work", "outputs", "public"]);

const pages = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".html")) pages.push(full);
  }
})(root);

const svgShare = [];
const typeMismatch = [];
const sizeMismatch = [];
const missingTarget = [];

for (const file of pages) {
  const relative = path.relative(root, file);
  const html = fs.readFileSync(file, "utf8");

  const ogImage = (html.match(/<meta property="og:image" content="([^"]+)"/i) || [])[1];
  const twImage = (html.match(/<meta name="twitter:image" content="([^"]+)"/i) || [])[1];
  const ogType = (html.match(/<meta property="og:image:type" content="([^"]+)"/i) || [])[1];
  const ogW = (html.match(/<meta property="og:image:width" content="([^"]+)"/i) || [])[1];
  const ogH = (html.match(/<meta property="og:image:height" content="([^"]+)"/i) || [])[1];

  for (const [label, value] of [["og:image", ogImage], ["twitter:image", twImage]]) {
    if (!value) continue;
    if (/\.svg$/i.test(value)) svgShare.push(`${relative}: ${label} → ${value}`);
  }

  if (ogType && ogType !== "image/png") typeMismatch.push(`${relative}: ${ogType}`);

  if (!ogImage || !ogImage.startsWith(`${DOMAIN}/`)) continue;
  const target = path.join(root, ogImage.slice(DOMAIN.length + 1));
  if (!fs.existsSync(target)) { missingTarget.push(`${relative}: ${ogImage}`); continue; }

  // BİLDİRİLEN ÖLÇÜ GERÇEK DOSYAYLA UYUŞMALI. Yanlış ölçü, önizlemeyi
  // kırpan ya da hiç göstermeyen bir kart üretir.
  if (ogW || ogH) {
    const { width, height } = readImageSize(target);
    if (String(width) !== ogW || String(height) !== ogH) {
      sizeMismatch.push(`${relative}: bildirilen ${ogW}×${ogH}, gerçek ${width}×${height}`);
    }
  }
}

const show = (list) => list.slice(0, 5).join("\n    ") + (list.length > 5 ? `\n    … +${list.length - 5}` : "");
assert.equal(svgShare.length, 0, `SVG paylaşım görseli bildiren sayfa (sosyal ağlar çözemez):\n    ${show(svgShare)}`);
assert.equal(typeMismatch.length, 0, `og:image:type PNG değil:\n    ${show(typeMismatch)}`);
assert.equal(missingTarget.length, 0, `og:image hedefi diskte yok:\n    ${show(missingTarget)}`);
assert.equal(sizeMismatch.length, 0, `bildirilen ölçü dosyayla uyuşmuyor:\n    ${show(sizeMismatch)}`);

console.log(`OG görseli: ${EXPECTED.length} varlık (1200×630, PNG, <300 KB), ${pages.length} sayfa denetlendi — SVG paylaşım bildirimi yok.`);
