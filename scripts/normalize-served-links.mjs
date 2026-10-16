#!/usr/bin/env node
/**
 * Eğik çizgisiz klasör adresinde sunulan sayfalarda (`/en`) göreli
 * bağlantıları kök mutlak yola çevirir. Bkz. scripts/lib/servedLinks.mjs.
 * Son-işlem zincirinde, kendinden önceki enjektörlerin eklediği bağlantıları
 * da görmek için damga adımından hemen önce koşar. Idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { DIRECTORY_LIKE_PAGES, rootAbsoluteLinks } from "./lib/servedLinks.mjs";

const root = process.cwd();
let changed = 0;
for (const [file, spec] of DIRECTORY_LIKE_PAGES) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) continue;
  const before = fs.readFileSync(target, "utf8");
  const after = rootAbsoluteLinks(before, spec);
  if (after !== before) {
    fs.writeFileSync(target, after, "utf8");
    changed += 1;
  }
}
console.log(`served-links: ${changed} page(s) normalised (${DIRECTORY_LIKE_PAGES.size} directory-like).`);
