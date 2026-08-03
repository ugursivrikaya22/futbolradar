import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readJsonFile } from "./lib/readJsonFile.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { buildArchive, COVERAGE, WORKFLOW } = require("../services/historicalMatchArchive.js");
const apply = process.argv.includes("--apply");
const archivePath = path.join(root, "data", "historical-match-archive.json");
const statePath = path.join(root, "data", "historical-backfill-state.json");
const reports = readJsonFile(path.join(root, "data", "post-match-reports.json"), { records: [] });
const calendar = readJsonFile(path.join(root, "data", "fixture-calendar.json"), { matches: [] });
const matches = readJsonFile(path.join(root, "data", "matches.json"), []);
const previous = readJsonFile(archivePath, { records: [] });
const now = new Date().toISOString();
const result = buildArchive({
  previous,
  now,
  sources: [
    { name: "manual", records: Array.isArray(matches) ? matches : [] },
    { name: "fixture-calendar", records: Array.isArray(calendar.matches) ? calendar.matches : [] },
    { name: "report", records: Array.isArray(reports.records) ? reports.records : [] }
  ]
});
const counts = { FULL: 0, STANDARD: 0, LIMITED: 0, needs_manual_review: 0 };
for (const record of result.records) {
  if (record.workflowState === WORKFLOW.REVIEW) counts.needs_manual_review += 1;
  else counts[record.coverageLevel] += 1;
}
const payload = { source: "futbolradar-historical-match-archive", version: 1, updatedAt: now, matchCount: result.records.length, records: result.records };
const state = { version: 1, completedAt: now, totalFinishedMatches: result.records.length, coverage: counts, rejected: result.rejected, lastSuccessfulIdentity: result.records.at(-1)?.identity || null };
const stable = JSON.stringify((previous.records || []).map(({ archivedAt, ...record }) => record)) === JSON.stringify(result.records.map(({ archivedAt, ...record }) => record));
console.log(`[historical-archive] ${result.records.length} bitmiş maç · FULL ${counts.FULL}, STANDARD ${counts.STANDARD}, LIMITED ${counts.LIMITED}, inceleme ${counts.needs_manual_review}`);
if (!apply) process.exit(0);
if (!stable || !fs.existsSync(archivePath)) fs.writeFileSync(archivePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
for (const file of [archivePath, statePath]) { const target = path.join(root, "public", "data", path.basename(file)); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target); }
