#!/usr/bin/env node
/**
 * `mac-raporu/` ve `public/mac-raporu/` altındaki eski sayfalardan boş
 * bölümleri söker (bkz. lib/legacyReportCleanup.mjs). Yalnızca dosya
 * değişiyorsa yazar; ikinci koşu hiçbir şey yapmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { stripEmptyReportSections } from "./lib/legacyReportCleanup.mjs";

const root = process.cwd();
let changed = 0;
let scanned = 0;
for (const base of [root, path.join(root, "public")]) {
  const dir = path.join(base, "mac-raporu");
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".html")) continue;
    scanned += 1;
    const target = path.join(dir, file);
    const html = fs.readFileSync(target, "utf8");
    const next = stripEmptyReportSections(html);
    if (next !== html) {
      fs.writeFileSync(target, next, "utf8");
      changed += 1;
    }
  }
}
console.log(`clean-legacy-reports: ${scanned} sayfa tarandı, ${changed} sayfa temizlendi`);
