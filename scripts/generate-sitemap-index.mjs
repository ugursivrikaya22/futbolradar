import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const require = createRequire(import.meta.url);
const {
  SITEMAP_GROUPS,
  parseSitemapEntries,
  groupSitemapEntries,
  sitemapUrlset,
  sitemapIndexXml
} = require("../services/sitemapIndexService.js");

const sourcePath = path.join(root, "sitemap.xml");
if (!fs.existsSync(sourcePath)) {
  throw new Error("sitemap.xml bulunamadi; sitemap index olusturulamiyor.");
}

const entries = parseSitemapEntries(fs.readFileSync(sourcePath, "utf8"));
if (!entries.length) {
  throw new Error("sitemap.xml indekslenebilir URL icermiyor.");
}

const groupedEntries = groupSitemapEntries(entries);
const targets = [root, path.join(root, "public")];
for (const target of targets) {
  for (const group of SITEMAP_GROUPS) {
    fs.writeFileSync(
      path.join(target, group.fileName),
      sitemapUrlset(groupedEntries[group.id]),
      "utf8"
    );
  }
  fs.writeFileSync(
    path.join(target, "sitemap-index.xml"),
    sitemapIndexXml({ domain, groupedEntries }),
    "utf8"
  );
}

const summary = SITEMAP_GROUPS
  .map((group) => `${group.id}: ${groupedEntries[group.id].length}`)
  .join(", ");
console.log(`Generated sitemap index (${entries.length} URL: ${summary})`);
