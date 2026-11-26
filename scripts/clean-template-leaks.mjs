#!/usr/bin/env node
/**
 * ŞABLON ARTIKLARI SÜPÜRÜCÜSÜ — ters tırnak, boş değişken, yer tutucu.
 *
 * Üretilmiş sayfaların görünür metninde ("Veri kapsamı `", "York`s LNER ...",
 * "${coverage}", "undefined") şablondan sızan artıkları temizler. Kural ve
 * gerekçe: services/templateLeaks.js.
 *
 *   node scripts/clean-template-leaks.mjs            # onarır (son işlem zinciri)
 *   node scripts/clean-template-leaks.mjs --check    # yazmaz; kalıntı varsa çıkış 1
 *
 * İdempotent. Son işlem zincirinde `normalize-meta`dan ÖNCE koşar: meta
 * açıklaması onarılmış metin üzerinden kısaltılır.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cleanTemplateLeaks } = require("../services/templateLeaks.js");

const root = process.cwd();
const check = process.argv.includes("--check");
const SKIP_DIRS = new Set([".git", ".vercel", "node_modules", "scripts", "services", "server", "api", "docs", "lib", "components", "editorial", "locales", "data", "assets", "work", "outputs", "tests", "supabase"]);

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".html")) files.push(full);
  }
})(root);

let changed = 0;
let fixes = 0;
const dirty = [];
for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  // Hızlı ön süzgeç: şüpheli iz yoksa ayrıştırma yok (37 bin sayfa).
  if (!/[`]|\$\{|\{\{|%\{|undefined|\bnull\b|NaN|\[object Object\]/.test(html)) continue;
  const result = cleanTemplateLeaks(html);
  if (!result.leaks.length) continue;
  if (check) {
    dirty.push(`${path.relative(root, file)} (${result.leaks.join(", ")})`);
    continue;
  }
  if (result.changed) {
    fs.writeFileSync(file, result.html, "utf8");
    changed += 1;
    fixes += result.fixes;
  }
}

if (check) {
  if (dirty.length) {
    console.error(`clean-template-leaks: ${dirty.length} sayfada şablon artığı var:\n  ${dirty.slice(0, 20).join("\n  ")}`);
    process.exit(1);
  }
  console.log(`clean-template-leaks: ${files.length} sayfa temiz.`);
} else {
  console.log(`clean-template-leaks: ${changed}/${files.length} sayfa onarıldı (${fixes} düzeltme).`);
}
