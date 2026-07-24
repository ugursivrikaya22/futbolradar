import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { normalizeText } = require("../services/matchRadarService.js");

const VERCEL_HOBBY_FUNCTION_LIMIT = 12;
const SUSPICIOUS_KEYS = ["xg", "xa", "odds", "bettingodds", "marketodds", "bahisorani"];
const SECRET_PATTERNS = [/FOOTBALL_API_KEY/i, /FOOTBALL_DATA_API_KEY/i, /X-Auth-Token/i, /"apiKey"/i, /Bearer\s+[A-Za-z0-9._-]{10,}/];
const INTERNAL_ERROR_KEYS = ["stack", "errno", "stacktrace", "provider_error_raw"];

const failures = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const analyses = readJson(path.join(root, "data", "match-analyses.json"), []);
const players = readJson(path.join(root, "data", "players.json"), []);

function isNumberInRange(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function checkUniqueness() {
  const fixtureIdDupes = findDuplicates(analyses.map((item) => item.fixtureId));
  expect(fixtureIdDupes.length === 0, `Duplicate fixtureId values: ${fixtureIdDupes.join(", ")}`);

  const slugDupes = findDuplicates(analyses.map((item) => item.slug));
  expect(slugDupes.length === 0, `Duplicate slug values: ${slugDupes.join(", ")}`);
}

function checkTeamsAndKickoff(record) {
  const home = record.homeContext && record.homeContext.teamName;
  const away = record.awayContext && record.awayContext.teamName;
  expect(Boolean(home) && Boolean(away) && normalizeText(home) !== normalizeText(away), `${record.fixtureId}: home and away team must differ`);
  expect(record.kickoff && !Number.isNaN(Date.parse(record.kickoff)), `${record.fixtureId}: invalid ISO kickoff`);
}

function checkProbabilities(record) {
  const probabilities = record.prediction && record.prediction.probabilities;
  if (!probabilities) return;

  const { homeWin, draw, awayWin } = probabilities;
  [homeWin, draw, awayWin].forEach((value, index) => {
    expect(isNumberInRange(value, 0, 100), `${record.fixtureId}: probability[${index}] out of 0-100 range (${value})`);
  });
  const sum = Number(homeWin) + Number(draw) + Number(awayWin);
  expect(sum === 100, `${record.fixtureId}: probabilities sum to ${sum}, expected 100`);
}

function checkConfidenceRanges(record) {
  const confidenceValues = [
    ["dataConfidence", record.dataConfidence],
    ["prediction.confidence", record.prediction && record.prediction.prediction && record.prediction.prediction.confidence],
    ["prediction.dataConfidence", record.prediction && record.prediction.dataConfidence],
    ["homeContext.confidence", record.homeContext && record.homeContext.confidence],
    ["awayContext.confidence", record.awayContext && record.awayContext.confidence],
    ["matchup.confidence", record.matchup && record.matchup.confidence],
    ["probableLineups.home.confidence", record.probableLineups && record.probableLineups.home && record.probableLineups.home.confidence],
    ["probableLineups.away.confidence", record.probableLineups && record.probableLineups.away && record.probableLineups.away.confidence]
  ];

  for (const [label, value] of confidenceValues) {
    if (value === null || value === undefined) continue;
    expect(isNumberInRange(value, 0, 100), `${record.fixtureId}: ${label} out of 0-100 range (${value})`);
  }
}

function checkOverconfidentLowData(record) {
  const dataConfidence = record.dataConfidence;
  const predictionStatus = record.prediction && record.prediction.predictionStatus;
  const predictionConfidence = record.prediction && record.prediction.prediction && record.prediction.prediction.confidence;

  if (typeof dataConfidence === "number" && dataConfidence < 30) {
    const overconfident = predictionStatus === "available" && typeof predictionConfidence === "number" && predictionConfidence > 55;
    expect(!overconfident, `${record.fixtureId}: low dataConfidence (${dataConfidence}) but prediction reports high confidence (${predictionConfidence}) as "available"`);
  }
}

function checkLineupIntegrity(record) {
  ["home", "away"].forEach((side) => {
    const lineup = record.probableLineups && record.probableLineups[side];
    if (!lineup || !Array.isArray(lineup.starters)) return;

    const ids = lineup.starters.map((player) => player.id || player.name);
    const dupes = findDuplicates(ids);
    expect(dupes.length === 0, `${record.fixtureId}/${side}: duplicate player(s) in starting lineup: ${dupes.join(", ")}`);

    const teamName = record[`${side}Context`] && record[`${side}Context`].teamName;
    for (const starter of lineup.starters) {
      if (!starter.id) continue;
      const playerRecord = players.find((player) => (player.id || "") === starter.id);
      if (!playerRecord) continue;
      const departed = normalizeText(playerRecord.currentTeam || playerRecord.team) !== normalizeText(teamName);
      expect(!departed, `${record.fixtureId}/${side}: departed player "${starter.name}" appears in probable lineup`);
      const pending = normalizeText(playerRecord.transferStatus) === "pending" || playerRecord.pendingTransfer === true;
      expect(!pending, `${record.fixtureId}/${side}: pending-transfer player "${starter.name}" appears in probable lineup`);
    }

    const expectedLabel = lineup.status === "official" ? "Resmî İlk 11" : "Muhtemel İlk 11";
    expect(lineup.label === expectedLabel, `${record.fixtureId}/${side}: lineup label "${lineup.label}" does not match status "${lineup.status}"`);
  });
}

function checkFreezeInvariant(record) {
  if (record.status === "scheduled") return;
  expect(Boolean(record.preMatchFrozenAt), `${record.fixtureId}: status is "${record.status}" but preMatchFrozenAt was never set (pre-match snapshot not frozen)`);
  expect(Boolean(record.prediction && record.prediction.frozenAt), `${record.fixtureId}: status is "${record.status}" but prediction.frozenAt is missing`);
}

function checkKeyDuelConsistency(record) {
  const homeIds = new Set((record.probableLineups && record.probableLineups.home && record.probableLineups.home.starters || []).map((p) => p.id || p.name));
  const awayIds = new Set((record.probableLineups && record.probableLineups.away && record.probableLineups.away.starters || []).map((p) => p.id || p.name));

  for (const duel of record.keyDuels || []) {
    const homeKey = duel.homePlayer && (duel.homePlayer.id || duel.homePlayer.name);
    const awayKey = duel.awayPlayer && (duel.awayPlayer.id || duel.awayPlayer.name);
    expect(homeKey && homeIds.has(homeKey), `${record.fixtureId}: key duel "${duel.id}" home player not present in probable lineup`);
    expect(awayKey && awayIds.has(awayKey), `${record.fixtureId}: key duel "${duel.id}" away player not present in probable lineup`);
  }
}

function checkNoFabricatedZeros(record) {
  const context = record.homeContext;
  if (context && context.recentForm && context.recentForm.sampleSize === 0) {
    expect(context.recentForm.weightedScore === null, `${record.fixtureId}: empty recent form sample must not report a fabricated weightedScore of 0`);
  }
  if (context && context.goalTrend && context.goalTrend.sampleSize === 0) {
    expect(context.goalTrend.averageGoalsFor === null, `${record.fixtureId}: empty goal trend sample must not report a fabricated average of 0`);
  }
}

function checkNoFabricatedMarketData(record) {
  const text = JSON.stringify(record).toLowerCase();
  for (const key of SUSPICIOUS_KEYS) {
    expect(!text.includes(`"${key}"`), `${record.fixtureId}: unexpected market/xG-like field "${key}" found in analysis record`);
  }
}

function checkNoSecretsOrInternalErrors(record) {
  const text = JSON.stringify(record);
  for (const pattern of SECRET_PATTERNS) {
    expect(!pattern.test(text), `${record.fixtureId}: possible secret/API key material leaked into analysis record`);
  }
  const lower = text.toLowerCase();
  for (const key of INTERNAL_ERROR_KEYS) {
    expect(!lower.includes(`"${key}"`), `${record.fixtureId}: internal error field "${key}" leaked into analysis record`);
  }
}

function checkSlugLinkable(record) {
  expect(/^[a-z0-9-]+$/.test(record.slug || ""), `${record.fixtureId}: slug "${record.slug}" is not URL-safe for match detail links`);
}

function checkPublicSync() {
  const rootPath = path.join(root, "data", "match-analyses.json");
  const publicPath = path.join(root, "public", "data", "match-analyses.json");
  if (!fs.existsSync(rootPath) || !fs.existsSync(publicPath)) {
    failures.push("data/match-analyses.json or its public mirror is missing");
    return;
  }
  const rootContent = fs.readFileSync(rootPath, "utf8");
  const publicContent = fs.readFileSync(publicPath, "utf8");
  expect(rootContent === publicContent, "public/data/match-analyses.json is out of sync with data/match-analyses.json");
}

function checkApiFunctionLimit() {
  const apiDir = path.join(root, "api");
  const functionFiles = fs.readdirSync(apiDir).filter((file) => file.endsWith(".js") && !file.startsWith("_"));
  expect(functionFiles.length <= VERCEL_HOBBY_FUNCTION_LIMIT, `Vercel Hobby function limit exceeded: ${functionFiles.length}/${VERCEL_HOBBY_FUNCTION_LIMIT}`);
}

checkUniqueness();
for (const record of analyses) {
  checkTeamsAndKickoff(record);
  checkProbabilities(record);
  checkConfidenceRanges(record);
  checkOverconfidentLowData(record);
  checkLineupIntegrity(record);
  checkFreezeInvariant(record);
  checkKeyDuelConsistency(record);
  checkNoFabricatedZeros(record);
  checkNoFabricatedMarketData(record);
  checkNoSecretsOrInternalErrors(record);
  checkSlugLinkable(record);
}
checkPublicSync();
checkApiFunctionLimit();

if (failures.length) {
  console.error(`match-analyses validation failed with ${failures.length} issue(s):`);
  console.error(failures.map((message) => `  - ${message}`).join("\n"));
  process.exit(1);
}

console.log(`match-analyses validation passed for ${analyses.length} record(s).`);
