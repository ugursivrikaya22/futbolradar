import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validatePlayerData } = require("../services/playerService.js");
const {
  auditSquadIntegrity,
  reconcileConfirmedTransfers,
  syncTeamRecentTransfers
} = require("../services/transferSquadSyncService.js");

const root = process.cwd();
const playersPath = path.join(root, "data", "players.json");
const transfersPath = path.join(root, "data", "transfers.json");
const teamsPath = path.join(root, "data", "teams.json");
const apply = process.argv.includes("--apply");
const check = process.argv.includes("--check");
const players = JSON.parse(fs.readFileSync(playersPath, "utf8"));
const transfers = JSON.parse(fs.readFileSync(transfersPath, "utf8"));
const teams = JSON.parse(fs.readFileSync(teamsPath, "utf8"));
const result = reconcileConfirmedTransfers(players, transfers);
const nextTeams = syncTeamRecentTransfers(teams, transfers);
const playerValidation = validatePlayerData(result.players);
const integrity = auditSquadIntegrity(result.players, transfers);

if (!playerValidation.ok || !integrity.ok) {
  const errors = [...playerValidation.errors, ...integrity.errors];
  console.error(`Confirmed transfer sync failed (${errors.length}):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const before = `${JSON.stringify(players, null, 2)}\n`;
const after = `${JSON.stringify(result.players, null, 2)}\n`;
const teamsBefore = `${JSON.stringify(teams, null, 2)}\n`;
const teamsAfter = `${JSON.stringify(nextTeams, null, 2)}\n`;
const playersChanged = before !== after;
const teamsChanged = teamsBefore !== teamsAfter;
const changed = playersChanged || teamsChanged;
const summary = {
  confirmedTransfers: result.report.processed.length,
  createdProfiles: result.report.created.length,
  mergedProfiles: result.report.merged.length,
  removedDuplicates: result.report.duplicatesRemoved.length,
  playersChanged,
  teamsChanged,
  changed,
  pendingProvider: integrity.warnings.length
};

if (check && changed) {
  console.error(`Confirmed transfer sync is required: ${JSON.stringify(summary)}`);
  process.exit(1);
}

if (apply && changed) {
  if (playersChanged) {
    const tempPath = `${playersPath}.tmp`;
    fs.writeFileSync(tempPath, after, "utf8");
    fs.renameSync(tempPath, playersPath);
  }
  if (teamsChanged) {
    const tempPath = `${teamsPath}.tmp`;
    fs.writeFileSync(tempPath, teamsAfter, "utf8");
    fs.renameSync(tempPath, teamsPath);
  }
}

console.log(`${apply ? "Applied" : "Dry run"} confirmed transfer sync: ${JSON.stringify(summary)}`);
if (result.report.created.length) console.log(`Created: ${result.report.created.join(", ")}`);
if (result.report.merged.length) console.log(`Merged: ${result.report.merged.join(", ")}`);
if (result.report.duplicatesRemoved.length) console.log(`Removed duplicate records: ${result.report.duplicatesRemoved.join(", ")}`);
integrity.warnings.forEach((warning) => console.warn(`WARN ${warning}`));
