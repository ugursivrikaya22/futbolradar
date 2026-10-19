#!/usr/bin/env node
/**
 * FAVICON BİLDİRİMİNİ HER SAYFAYA TEK BİÇİMDE YAZ.
 *
 * Google, arama sonucunda site adının yanına ikon koymak için ana sayfanın
 * `<head>`inde açık bir `rel="icon"` bildirimi ve KARARLI, doğrudan
 * açılabilen bir adres arıyor. Sitede üç ayrı sorun vardı:
 *
 *   • `/favicon.ico` HİÇ YOKTU — Google'ın önce baktığı adres 404'tü.
 *   • Tek ikon `favicon.svg`'ydi; Google arama sonucu ikonu için raster
 *     bekliyor ve en az 48×48 kare istiyor.
 *   • Bildirimler GÖRELİ adreslerdi ve sayfa derinliğine göre değişiyordu:
 *     `./favicon.svg`, `../favicon.svg`, `../../favicon.svg`. Aynı ikonun
 *     üç farklı adresi, "favicon adresi kararlı olsun" kuralının tam tersi.
 *
 * Bu yüzden bildirim artık TEK YERDE üretiliyor ve KÖKE GÖRE MUTLAK. Adres
 * sayfa nerede olursa olsun aynı: `/favicon.ico`. 16 ayrı üretici kendi
 * göreli satırını basmaya devam ediyor; bu adım onları söküp yerine tek
 * biçimli bloğu koyuyor — üreticilerin hepsini tek tek düzenlemek, aynı
 * kuralı 16 yerde tekrar etmek ve birinin geride kalmasını beklemek olurdu.
 *
 * SÜRÜM DAMGASI YOK, BİLEREK. `inject-asset-version.mjs` `page.css` ve
 * `site.js`e `?v=<hash>` ekliyor; favicon'a EKLENMEZ. Değişen bir favicon
 * adresi, Google'ın ikonu yeniden keşfetmesini gerektirir ve her derlemede
 * yeniden keşfe zorlamak ikonun hiç yerleşmemesi demektir.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

const MARKER_START = "<!-- favicon:start -->";
const MARKER_END = "<!-- favicon:end -->";
const BLOCK_RE = /[\t ]*<!-- favicon:start -->[\s\S]*?<!-- favicon:end -->\n?/g;

/**
 * Üreticilerin bastığı ESKİ göreli satırlar. Blok yazılmadan önce sökülür,
 * yoksa aynı sayfada iki farklı ikon bildirimi kalır ve hangisinin
 * kazanacağı tarayıcıya göre değişir.
 */
const LEGACY_LINE_RE =
  /[\t ]*<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>\n?/gi;

/**
 * Bildirilen dosyalar. Sıra rastgele değil: ICO en başta, çünkü Google'ın
 * ve eski tarayıcıların ilk baktığı o. SVG hemen ardından geliyor —
 * destekleyen tarayıcı onu seçer ve her ölçekte keskin kalır.
 */
const ICON_FILES = [
  "favicon.ico",
  "favicon.svg",
  "favicon-48x48.png",
  "favicon-96x96.png",
  "favicon-192x192.png",
  "favicon-512x512.png",
  "apple-touch-icon.png",
  "site.webmanifest",
  "en/site.webmanifest"
];

const blockFor = (manifest) => `${MARKER_START}
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />
<link rel="icon" type="image/png" sizes="512x512" href="/favicon-512x512.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="${manifest}" />
${MARKER_END}`;
const BLOCK = blockFor("/site.webmanifest");
const EN_BLOCK = blockFor("/en/site.webmanifest");
const isEnglishPage = (file) => /^(?:public\/)?en\//.test(path.relative(root, file).split(path.sep).join("/"));

function collectHtmlFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectHtmlFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) found.push(full);
  }

  return found;
}

const problems = [];

// ── Önce dosyalar gerçekten var mı ────────────────────────────────────────
//
// Olmayan bir ikona bağlantı vermek, hiç bağlantı vermemekten kötü: Google
// bildirimi görür, adresi çeker, 404 alır ve ikonu tamamen düşürür.
for (const name of ICON_FILES) {
  if (!fs.existsSync(path.join(root, name))) {
    problems.push(`${name}: dosya yok — bildirim yazılamaz (scripts/generate-favicons.mjs)`);
  }
}

if (problems.length) {
  console.error("favicon injection FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exit(1);
}

let updated = 0;
let checked = 0;

for (const file of collectHtmlFiles(root)) {
  const original = fs.readFileSync(file, "utf8");
  if (!/<\/head>/i.test(original)) continue;

  checked += 1;
  const stripped = original.replace(BLOCK_RE, "").replace(LEGACY_LINE_RE, "");
  const next = stripped.replace(/<\/head>/i, `${isEnglishPage(file) ? EN_BLOCK : BLOCK}\n  </head>`);
  if (next === original) continue;

  if (CHECK_ONLY) {
    problems.push(`${path.relative(root, file)}: favicon bloğu güncel değil`);
    continue;
  }

  fs.writeFileSync(file, next, "utf8");
  updated += 1;
}

if (problems.length) {
  console.error("favicon injection FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log(`favicon: ${checked} sayfa denetlendi, hepsi güncel.`);
} else {
  console.log(`favicon: ${updated}/${checked} sayfa güncellendi (kök-mutlak /favicon.ico).`);
}
