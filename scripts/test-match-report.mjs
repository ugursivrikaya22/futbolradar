import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const mockProvider = require("../services/providers/mockProvider.js");
const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const match = matches.find((item) => item.id === "fenerbahce-gornik-zabrze-2026-07-21");
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function statistic(type) {
  return match && match.statistics.find((item) => item.type === type);
}

expect(Boolean(match), "Fenerbahçe - Górnik Zabrze match record is missing");
expect(match && match.status === "FINISHED", "Match must be marked FINISHED");
expect(match && match.score.home === 1 && match.score.away === 0, "Final score must be 1-0");
expect(match && match.score.halftimeHome === 1 && match.score.halftimeAway === 0, "Half-time score must be 1-0");
expect(match && match.dataStatus === "verified" && match.needsReview === false, "Match verification state is invalid");
expect(match && Array.isArray(match.statistics) && match.statistics.length >= 25, "Full match statistics are incomplete");
expect(match && Array.isArray(match.lineups) && match.lineups.every((item) => item.players.length === 11), "Starting lineups must contain 11 players");
expect(match && Array.isArray(match.substitutions) && match.substitutions.length === 9, "Substitution list is incomplete");
expect(match && Array.isArray(match.events) && match.events.some((item) => item.type === "Gol" && item.time === "37'"), "Talisca goal event is missing");
expect(statistic("Topla oynama")?.home === 79 && statistic("Topla oynama")?.away === 21, "Possession values are invalid");
expect(statistic("Gol beklentisi (xG)")?.home === 1.54 && statistic("Gol beklentisi (xG)")?.away === 0.06, "xG values are invalid");
expect(statistic("Toplam şut")?.home === 15 && statistic("Toplam şut")?.away === 2, "Shot values are invalid");
expect(statistic("Toplam pas")?.home === 762 && statistic("Toplam pas")?.away === 200, "Pass values are invalid");
expect(match && !JSON.stringify(match).includes("FOOTBALL_API_KEY"), "Secret key marker must not appear in match data");

const detail = await mockProvider.getMatchDetail({ id: "fenerbahce-gornik-zabrze-2026-07-21" });
expect(detail && detail.analysisPage === "fenerbahce-gornik-zabrze-mac-analizi.html", "API detail permalink is missing");
expect(detail && detail.statistics.length === match.statistics.length, "API detail must preserve all statistics");
expect(detail && detail.lineups.length === 2 && detail.substitutions.length === 9, "API detail must preserve lineup and substitution data");
expect(detail && detail.events.some((item) => item.type === "Gol"), "API detail must preserve match events");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Post-match report checks passed");
