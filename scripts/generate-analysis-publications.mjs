import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const root = process.cwd(); const require = createRequire(import.meta.url);
const { buildPublications } = require("../services/analysisPublicationService.js");
const reports = JSON.parse(fs.readFileSync(path.join(root, "data", "post-match-reports.json"), "utf8"));
const output = path.join(root, "data", "analysis-publications.json");
const previous = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : { publications: [] };
const { publications, queue } = buildPublications(reports.records || [], previous.publications || []);
const payload = { source: "futbolradar-analysis-publications", generatedAt: new Date().toISOString(), publishedCount: publications.filter((item) => item.status === "published").length, draftCount: publications.filter((item) => item.status === "draft").length, queue, publications };
if (process.argv.includes("--apply")) {
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
  const publicPath = path.join(root, "public", "data", "analysis-publications.json"); fs.mkdirSync(path.dirname(publicPath), { recursive: true }); fs.writeFileSync(publicPath, `${JSON.stringify(payload, null, 2)}\n`);
}
console.log(`[analysis-publications] ${publications.length} içerik · ${payload.publishedCount} yayınlanabilir · ${payload.draftCount} taslak · ${queue.length} kuyruk`);
