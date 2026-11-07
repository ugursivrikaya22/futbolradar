#!/usr/bin/env node
/**
 * TÜRKÇE SAYFALARA hreflang ÇİFTİNİ YAZ.
 *
 * İngilizce sayfalar kendi `<head>`lerinde her iki dili de gösteriyor
 * (scripts/generate-en-pages.mjs). Türkçe taraf da aynısını yapmak ZORUNDA:
 * Google alternate ilişkisini yalnızca KARŞILIKLI olduğunda kabul eder.
 * Tek yönlü bir bildirim yok sayılır ve iki sürüm birbirinin kopyası gibi
 * değerlendirilir — yani İngilizce sürüm hiç indekslenmeyebilir.
 *
 * `x-default` Türkçedir: ana alan adı Türkçe kalır, dili belirsiz ziyaretçi
 * Türkçe sürüme yönlendirilir. Otomatik tarayıcı-dili yönlendirmesi YOK;
 * kullanıcı dili kendi seçer.
 *
 * Blok işaretle sarılıyor, böylece her derlemede yeniden yazılabilir ve
 * sayfanın geri kalanına dokunulmaz. `--check` yalnızca doğrular.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ROUTES, dynamicRoutePairs, hreflangOf, pairUrl } = require("../services/i18n.js");

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");
const MARKER_START = "<!-- hreflang:start -->";
const MARKER_END = "<!-- hreflang:end -->";
const BLOCK_RE = /[\t ]*<!-- hreflang:start -->[\s\S]*?<!-- hreflang:end -->\n?/g;

function alternateBlock(route) {
  // Satır uzantısız kanonik taşıyorsa (maç SEO sayfaları) hreflang da aynı
  // adresi gösterir: canonical ile alternate birbirinden ayrışmaz.
  const trUrl = pairUrl(route, "tr");
  const enUrl = pairUrl(route, "en");
  return `${MARKER_START}
<link rel="alternate" hreflang="${hreflangOf("tr")}" href="${trUrl}" />
<link rel="alternate" hreflang="${hreflangOf("en")}" href="${enUrl}" />
<link rel="alternate" hreflang="x-default" href="${trUrl}" />
${MARKER_END}`;
}

/** Kök ve `public/` aynaları birlikte işlenir; ikisi de yayımlanıyor. */
function targetsFor(relativePath) {
  return [path.join(root, relativePath), path.join(root, "public", relativePath)]
    .filter((file) => fs.existsSync(file));
}

function injectInto(file, block, problems) {
  const original = fs.readFileSync(file, "utf8");
  const stripped = original.replace(BLOCK_RE, "");
  if (!/<\/head>/i.test(stripped)) {
    problems.push(`${path.relative(root, file)}: <head> kapanışı yok, hreflang yazılamadı`);
    return { checked: true, updated: false };
  }

  const next = stripped.replace(/<\/head>/i, `${block}\n  </head>`);
  if (next === original) return { checked: true, updated: false };

  if (CHECK_ONLY) {
    problems.push(`${path.relative(root, file)}: hreflang bloğu güncel değil`);
    return { checked: true, updated: false };
  }

  fs.writeFileSync(file, next, "utf8");
  return { checked: true, updated: true };
}

let updated = 0;
let checked = 0;
const problems = [];

// Çekirdek 6 sayfa: İngilizce taraf kendi üreticisinde (generate-en-pages.mjs)
// hreflang'ı ZATEN gövdeye gömüyor. Burada yalnızca Türkçe tarafa yazılıyor;
// aksi hâlde aynı sayfaya iki farklı biçimde (gömülü + işaretli blok)
// çakışan bir ikinci alternate kümesi eklenirdi.
for (const route of ROUTES) {
  const block = alternateBlock(route);
  for (const file of targetsFor(route.tr)) {
    const result = injectInto(file, block, problems);
    checked += result.checked ? 1 : 0;
    updated += result.updated ? 1 : 0;
  }
}

// Dinamik çiftler: EN üreticilerin hiçbiri hreflang'ı gömmüyor — sayfa
// sayısı üç haneli olduğu için tekilleştirme burada, TEK yerde. Her iki
// taraf da (TR ve EN) bu geçişte yazılıyor.
//
// TÜR SÜZGECİ YOK, BİLEREK. Liste önce `team`/`match`/`player` diye elle
// sayılıyordu; maç dosyası sayfaları haritaya `special` türüyle eklendiğinde
// dil değiştirme bağlantısı çalıştı ama `<link rel="alternate">` etiketleri
// hiç basılmadı — Google tek yönlü bildirimi yok sayar, yani 24 sayfanın
// İngilizce yüzeyi indekslenmeme riskindeydi. Sessiz ve fark edilmesi zor
// bir arıza; haritaya giren HER çift artık kendiliğinden kapsanıyor.
// Yalnızca Türkçe olan sayfalar: İngilizce karşılığı YOK (kanal/iddaa
// verisi yalnızca TR kaynaklı). Sahte bir EN çifti uydurmak yerine kendine
// referans veren tr-TR + x-default bloğu yazılır; böylece Google dil/bölge
// hedefini net okur ve sayfa hreflang denetiminde "eksik" görünmez.
const TR_ONLY_PAGES = Object.freeze([
  "bugunun-maclari-hangi-kanalda.html",
  "yarinki-maclar-hangi-kanalda.html",
  "iddaa-sonuclari.html",
  "bahis-sonuclari.html",
  "canli-mac-sonuclari.html"
]);
function trOnlyBlock(relativePath) {
  const html = fs.readFileSync(path.join(root, relativePath), "utf8");
  const canonical = (html.match(/rel="canonical"\s+href="([^"]+)"/i) || [])[1]
    || `https://www.futbolradar.com/${relativePath}`;
  return `${MARKER_START}
<link rel="alternate" hreflang="${hreflangOf("tr")}" href="${canonical}" />
<link rel="alternate" hreflang="x-default" href="${canonical}" />
${MARKER_END}`;
}
for (const page of TR_ONLY_PAGES) {
  if (!fs.existsSync(path.join(root, page))) continue;
  const block = trOnlyBlock(page);
  for (const file of targetsFor(page)) {
    const result = injectInto(file, block, problems);
    checked += result.checked ? 1 : 0;
    updated += result.updated ? 1 : 0;
  }
}

const dynamicRoutes = dynamicRoutePairs();
for (const route of dynamicRoutes) {
  const block = alternateBlock(route);
  for (const side of [route.tr, route.en]) {
    for (const file of targetsFor(side)) {
      const result = injectInto(file, block, problems);
      checked += result.checked ? 1 : 0;
      updated += result.updated ? 1 : 0;
    }
  }
}

if (problems.length) {
  console.error("hreflang injection FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log(`hreflang: ${checked} sayfa denetlendi, hepsi güncel.`);
} else {
  console.log(`hreflang: ${updated} sayfa güncellendi, ${checked - updated} zaten güncel.`);
}
