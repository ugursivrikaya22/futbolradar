#!/usr/bin/env node
/**
 * İNCE MAÇ RAPORU KURALI — eşik, yön ve tutarlılık denetimi.
 *
 * Kural: kapsamı `THIN_COVERAGE_THRESHOLD` ve altında kalan rapor sayfası
 * `noindex,follow` olur ve site haritasından çıkar; üstüne çıkan sayfa
 * `index` olur ve geri girer. Sayfa HİÇBİR durumda silinmez ya da
 * yönlendirilmez — erişilebilir kalır.
 *
 * Bu testin asıl işi, kuralın İKİ YÖNLÜ kaldığını korumak. "Bir kerelik
 * temizlik" hâline düşmüş bir uygulama bugün doğru görünür: ince sayfalar
 * noindex'tir, sayılar tutar. Bozulma, sağlayıcı eksik dökümü yayımladığı
 * gün ortaya çıkar — sayfa kapsamı yükselmesine rağmen noindex kalır ve
 * kimse fark etmez. Bu yüzden burada yalnızca sonuç değil, KAYIT ile
 * SAYFA arasındaki eşleşme denetleniyor.
 *
 * UZLAŞTIRMA: HEDEFİ OLAN KOPYA İNDEKSTEN ÇEKİLMEZ. Raporun maçının
 * kalıcı bir `/mac/` sayfası varsa o rapor bir KOPYA'dır ve
 * `unify-match-canonicals` onun canonical'ını o sayfaya çevirir. Aynı
 * sayfaya `noindex` de basmak çelişkili sinyal olur: canonical
 * "asıl adres şu" derken noindex "beni indeksleme" diyor, ve Google
 * `noindex`i canonical hedefine taşıyabiliyor. Bu yüzden ince kural
 * yalnızca HEDEFİ OLMAYAN rapora uygulanır; hedefi olan rapor
 * `index,follow` kalır ve otoritesi canonical ile tek adrese toplanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { slugForMatch } = require("../services/matchSeoPages.js");

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";
const GENERATOR = path.join(root, "scripts", "generate-post-match-pages.mjs");

// ── 1. Eşik TEK SABİT olarak duruyor mu? ──────────────────────────────────
const source = fs.readFileSync(GENERATOR, "utf8");
const declared = source.match(/^const THIN_COVERAGE_THRESHOLD = (\d+);$/m);
assert.ok(declared, "generate-post-match-pages.mjs: THIN_COVERAGE_THRESHOLD tek satırlık sabit olarak tanımlı olmalı");
const THRESHOLD = Number(declared[1]);
assert.ok(Number.isInteger(THRESHOLD) && THRESHOLD >= 0 && THRESHOLD <= 100,
  `eşik 0-100 arası olmalı: ${THRESHOLD}`);
// Eşik başka bir yerde ikinci kez tanımlanmış olmamalı.
assert.equal((source.match(/THIN_COVERAGE_THRESHOLD = /g) || []).length, 1,
  "eşik birden fazla yerde tanımlanmış");

// ── 2. Depo kaydı → sayfa eşleşmesi ───────────────────────────────────────
const store = JSON.parse(fs.readFileSync(path.join(root, "data", "post-match-reports.json"), "utf8"));
const byFile = new Map();
for (const record of store.records || []) {
  const relative = record && record.seo && record.seo.path;
  if (relative) byFile.set(path.basename(relative), record);
}

const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const dir = path.join(root, "mac-raporu");
assert.ok(fs.existsSync(dir), "mac-raporu/ dizini olmalı");

const wrongDirective = [];
const thinInSitemap = [];
const indexableMissing = [];
const mirrorMismatch = [];
let thin = 0;
let indexable = 0;
let targeted = 0;
const conflicting = [];
// Kalıcı maç arşivine 301 ile yönlenen raporlar (middleware.js) site haritası
// kuralının dışında: adresleri artık arşiv sayfası, kopya değil.
const archiveIndexPath = path.join(root, "data", "match-archive-index.json");
const archiveRedirected = new Set();
if (fs.existsSync(archiveIndexPath)) {
  for (const rec of JSON.parse(fs.readFileSync(archiveIndexPath, "utf8")).records || []) {
    if (rec.generated) for (const legacy of rec.legacy || []) archiveRedirected.add(legacy);
  }
}
let redirectedToArchive = 0;

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith(".html")) continue;
  const relative = `mac-raporu/${file}`;
  const html = fs.readFileSync(path.join(dir, file), "utf8");
  const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1] || "";

  if (archiveRedirected.has(relative.replace(/\.html$/, ""))) { redirectedToArchive += 1; continue; }
  const record = byFile.get(file);
  // Kaydı olmayan sayfanın kapsamı BİLİNMİYOR; bilinmeyen kapsam ince sayılır.
  const coverage = record && Number.isFinite(record.coveragePercent) ? record.coveragePercent : 0;
  const isThin = coverage <= THRESHOLD;
  // Maçın kalıcı `/mac/` sayfası varsa bu rapor bir kopyadır.
  const hasTarget = Boolean(record && slugForMatch(record));
  const inSitemap = sitemap.includes(`<loc>${DOMAIN}/${relative}</loc>`);

  if (hasTarget) {
    // Hedefi olan kopya: `noindex` ALMAZ. Site haritasında olup olmadığı
    // burada iddia EDİLMEZ — birleştirme adımı kopyayı haritadan
    // çıkarıyor ve o da doğru davranış.
    targeted += 1;
    if (/noindex/i.test(robots)) {
      conflicting.push(`${relative}: /mac/ hedefi var ama robots="${robots}"`);
    }
  } else if (isThin) {
    thin += 1;
    if (robots !== "noindex,follow") wrongDirective.push(`${relative}: kapsam %${coverage} ama robots="${robots}"`);
    if (inSitemap) thinInSitemap.push(`${relative} (kapsam %${coverage})`);
  } else {
    indexable += 1;
    if (/noindex/i.test(robots)) wrongDirective.push(`${relative}: kapsam %${coverage} ama robots="${robots}"`);
    if (!inSitemap) indexableMissing.push(`${relative} (kapsam %${coverage})`);
  }

  // SAYFA SİLİNMEDİ/YÖNLENDİRİLMEDİ: dosya yerinde ve gövdesi var.
  assert.ok(html.includes("<body"), `${relative}: sayfa gövdesi olmalı (silinmemeli)`);

  // `public/` aynası aynı yönergeyi taşımalı.
  const mirror = path.join(root, "public", relative);
  if (fs.existsSync(mirror)) {
    const mirrorRobots = (fs.readFileSync(mirror, "utf8").match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1] || "";
    if (mirrorRobots !== robots) mirrorMismatch.push(`${relative}: kök "${robots}" ≠ public "${mirrorRobots}"`);
  }
}

const show = (list) => list.slice(0, 5).join("\n    ") + (list.length > 5 ? `\n    … +${list.length - 5}` : "");
// ÇELİŞKİLİ SİNYAL KAPISI: hedefi olan kopyada `noindex` olamaz. Bu iki
// kural birbirini bozarsa önce burada patlar, canlıda değil.
assert.equal(conflicting.length, 0,
  `hedefi olan kopya noindex almış (canonical ile çelişiyor):\n    ${show(conflicting)}`);

assert.equal(wrongDirective.length, 0, `robots yönergesi kapsamla uyuşmuyor:\n    ${show(wrongDirective)}`);
assert.equal(thinInSitemap.length, 0,
  `ince sayfa site haritasında (çelişkili sinyal):\n    ${show(thinInSitemap)}`);
assert.equal(indexableMissing.length, 0,
  `kapsamı yeterli sayfa site haritasında YOK — kapsam yükselince geri girmeli:\n    ${show(indexableMissing)}`);
assert.equal(mirrorMismatch.length, 0, `public aynası farklı yönerge taşıyor:\n    ${show(mirrorMismatch)}`);

assert.ok(thin + indexable > 0, "hiç rapor sayfası bulunamadı");

console.log(`İnce kapsam kuralı (eşik %${THRESHOLD}): ${thin} ince (noindex,follow, site haritası dışı), ${indexable} indekslenebilir, ${targeted} hedefi olan kopya (noindex almaz) — ${thin + indexable + targeted} sayfa denetlendi, hepsi erişilebilir.`);
