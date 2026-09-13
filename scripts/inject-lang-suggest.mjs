#!/usr/bin/env node
/**
 * DİL ÖNERİ BANDINI HER SAYFAYA BAĞLA.
 *
 * `lang-suggest.js` üstte tek satırlık bir "View FutbolRadar in English"
 * önerisi gösteriyor (gerekçeler o dosyanın başında). Bu adım yalnızca
 * betiği sayfalara bağlar.
 *
 * `defer`: bant kritik yol değil. Senkron yüklenseydi, hiçbir zaman
 * gösterilmeyecek sayfalarda bile (tarayıcı dili zaten uyan ziyaretçiler —
 * yani ziyaretçilerin çoğu) ilk boyamayı geciktirirdi. Görevin 16. maddesi:
 * İngilizce sayfalara gereksiz JavaScript yükleme.
 *
 * Betik SADECE dil düğmesi olan sayfalara giriyor: düğme yoksa bandın
 * gösterecek bir hedefi de yok ve dosyayı indirmek boşa istek olurdu.
 *
 * İşaretli blok idempotan: her derlemede sökülüp yeniden yazılıyor, böylece
 * `inject-asset-version` damgası değiştiğinde eski etiket birikmiyor.
 */
import fs from "node:fs";
import path from "node:path";
import { LANG_SUGGEST_BOOT, LANG_SUGGEST_MARKER } from "./lib/langSuggestBoot.mjs";

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");
const MARKER = "data-futbolradar-lang-suggest";
const BLOCK_RE = /[\t ]*<script [^>]*data-futbolradar-lang-suggest[^>]*><\/script>\n?/g;
// Senkron karar snippet'i: `<head>` içinde, İLK BOYAMADAN ÖNCE.
const BOOT_RE = /[\t ]*<script [^>]*data-futbolradar-lang-boot[^>]*>[\s\S]*?<\/script>\n?/g;
const BOOT_TAG = `  <script ${LANG_SUGGEST_MARKER}>${LANG_SUGGEST_BOOT}</script>`;

// Google mülkiyet doğrulama dosyasına hiçbir etiket enjekte edilmez.
const SKIP_FILES = new Set(["googlef881b0d7527a8fba.html"]);
const SKIP_DIRS = new Set([".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(fullPath);
  }
  return files;
}

/** Sayfanın köke göre derinliği; betik adresi ona göre göreliyor. */
function baseFor(file) {
  const siteRoot = file.startsWith(path.join(root, "public")) ? path.join(root, "public") : root;
  const depth = path.relative(siteRoot, file).split(path.sep).length - 1;
  return depth > 0 ? "../".repeat(depth) : "./";
}

let updated = 0;
let skipped = 0;
const problems = [];

for (const file of walk(root)) {
  const original = fs.readFileSync(file, "utf8");
  const stripped = original.replace(BLOCK_RE, "").replace(BOOT_RE, "");

  // Dil düğmesi yoksa bandın hedefi de yok — ne snippet ne betik bağlanır.
  // Bu kapı aynı zamanda "yer ayırdım ama bant çıkmadı" durumunu imkânsız
  // kılıyor: snippet yalnızca karşılığı OLAN sayfalara giriyor.
  if (!stripped.includes("data-lang-switch") || !/<\/body>/i.test(stripped) || !/<\/head>/i.test(stripped)) {
    if (stripped !== original && !CHECK_ONLY) {
      fs.writeFileSync(file, stripped, "utf8");
      updated += 1;
    } else {
      skipped += 1;
    }
    continue;
  }

  const tag = `  <script ${MARKER} src="${baseFor(file)}lang-suggest.js" defer></script>`;
  const next = stripped
    .replace(/<\/head>/i, `${BOOT_TAG}\n  </head>`)
    .replace(/<\/body>/i, `${tag}\n  </body>`);

  if (next === original) {
    skipped += 1;
    continue;
  }
  if (CHECK_ONLY) {
    problems.push(`${path.relative(root, file)}: dil öneri bandı etiketi güncel değil`);
    continue;
  }

  fs.writeFileSync(file, next, "utf8");
  updated += 1;
}

if (problems.length) {
  console.error("lang-suggest injection FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else {
  console.log(`[lang-suggest] ${updated} sayfa güncellendi, ${skipped} sayfa dokunulmadı.`);
}
