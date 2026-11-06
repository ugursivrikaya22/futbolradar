#!/usr/bin/env node
/** Son işlem: sitemap'ten noindex URL'leri çıkarır, eksik köşe yazılarını ekler. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOMAIN, locToFile, pruneNoindexEntries, pruneMissingLocalEntries, addMissingColumns } from "./lib/sitemapIndexability.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readHtml(loc) {
  const file = locToFile(root, loc);
  return file ? fs.readFileSync(file, "utf8") : null;
}

function columnPages() {
  const dir = path.join(root, "kose-yazilari");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".html")).sort().map((name) => ({
    loc: `${DOMAIN}/kose-yazilari/${name}`,
    html: fs.readFileSync(path.join(dir, name), "utf8")
  }));
}

const columns = columnPages();
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const before = fs.readFileSync(sitemapPath, "utf8");
  const pruned = pruneNoindexEntries(before, readHtml);
  const missing = pruneMissingLocalEntries(pruned.xml, readHtml);
  const filled = addMissingColumns(missing.xml, columns);
  if (filled.xml !== before) fs.writeFileSync(sitemapPath, filled.xml, "utf8");
  console.log(`sitemap-indexability: ${path.relative(root, sitemapPath)} — ${pruned.removed.length} noindex, ${missing.removed.length} eksik dosya çıkarıldı, ${filled.added.length} köşe yazısı eklendi.`);
}
