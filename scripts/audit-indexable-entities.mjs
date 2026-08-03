import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const require = createRequire(import.meta.url);
const { parseSitemapEntries } = require("../services/sitemapIndexService.js");
const { entityTypeForPath, evaluateEntitySeoPage } = require("../services/entitySeoQualityService.js");

const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const entityEntries = parseSitemapEntries(sitemap)
  .map((entry) => ({ ...entry, type: entityTypeForPath(entry.pathname) }))
  .filter((entry) => entry.type);

const results = entityEntries.map((entry) => {
  const directPath = path.join(root, entry.pathname.replace(/^\//, ""));
  const filePath = fs.existsSync(directPath) ? directPath : `${directPath}.html`;
  if (!fs.existsSync(filePath)) {
    return {
      url: entry.location,
      type: entry.type,
      indexable: false,
      issueCodes: ["missing-static-html"],
      metrics: null
    };
  }

  return {
    url: entry.location,
    type: entry.type,
    ...evaluateEntitySeoPage({
      html: fs.readFileSync(filePath, "utf8"),
      canonicalUrl: entry.location
    })
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  source: `${domain}/sitemap.xml`,
  summary: {
    entities: results.length,
    ready: results.filter((result) => result.indexable).length,
    needsReview: results.filter((result) => !result.indexable).length,
    byType: Object.fromEntries([...new Set(results.map((result) => result.type))].map((type) => [
      type,
      results.filter((result) => result.type === type).length
    ]))
  },
  results
};

for (const target of [path.join(root, "data"), path.join(root, "public", "data")]) {
  fs.writeFileSync(path.join(target, "seo-entity-quality.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(`SEO entity audit: ${report.summary.ready}/${report.summary.entities} ready, ${report.summary.needsReview} need review`);
