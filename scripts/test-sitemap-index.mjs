import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  SITEMAP_GROUPS,
  parseSitemapEntries,
  groupSitemapEntries,
  sitemapIndexXml,
  sitemapUrlset
} = require("../services/sitemapIndexService.js");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.futbolradar.com/mac/a-b.html</loc><lastmod>2026-08-03</lastmod></url>
  <url><loc>https://www.futbolradar.com/oyuncular/test.html</loc><lastmod>2026-08-02</lastmod></url>
  <url><loc>https://www.futbolradar.com/kose-yazilari/test.html</loc><lastmod>2026-08-01</lastmod></url>
  <url><loc>https://www.futbolradar.com/super-lig-fikstur.html</loc><lastmod>2026-08-03</lastmod></url>
</urlset>`;

const entries = parseSitemapEntries(xml);
const grouped = groupSitemapEntries(entries);
assert.equal(entries.length, 4);
assert.equal(grouped.matches.length, 1);
assert.equal(grouped.players.length, 1);
assert.equal(grouped.editorial.length, 1);
assert.equal(grouped.core.length, 1);
assert.equal(Object.values(grouped).flat().length, entries.length);
assert.match(sitemapUrlset(grouped.matches), /<urlset/);

const index = sitemapIndexXml({ domain: "https://www.futbolradar.com", groupedEntries: grouped });
for (const group of SITEMAP_GROUPS) {
  assert.match(index, new RegExp(group.fileName.replace(".", "\\.")));
}
console.log("Sitemap index tests passed");
