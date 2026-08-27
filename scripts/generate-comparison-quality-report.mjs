import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const { buildComparisonQualityReport } = require("../services/comparisonQualityService.js");

const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8")));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));

const report = buildComparisonQualityReport({ players, teams, transfers });
const contents = `${JSON.stringify(report, null, 2)}\n`;

let updated = 0;
for (const target of [
  path.join(root, "data", "comparison-quality-report.json"),
  path.join(root, "public", "data", "comparison-quality-report.json")
]) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (current !== contents) {
    fs.writeFileSync(target, contents, "utf8");
    updated += 1;
  }
}

console.log(`::summary::${JSON.stringify({ filesUpdated: updated, totalIssues: report.summary.totalIssues, totalPlayers: report.summary.totalPlayers })}`);
