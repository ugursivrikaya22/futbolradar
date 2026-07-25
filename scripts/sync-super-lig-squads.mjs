import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { fetchCurrentSuperLigTeams, evaluateTeamListChange, mergeTeamList } = require("../services/teamSyncService.js");
const { fetchTeamSquad, buildSquadSnapshot, evaluateSquadSyncSafety, detectProviderIdConflicts } = require("../services/squadSyncService.js");

const TEAMS_PATH = path.join(root, "data", "teams.json");
const SQUADS_PATH = path.join(root, "data", "super-lig-squads.json");

function parseArgs(argv) {
  const args = { apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--team=")) args.team = raw.slice("--team=".length);
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!apiFootballProvider.hasConfig()) {
    console.log("No live provider configured (APIFOOTBALL_API_KEY missing). This is the expected state in this " +
      "environment. Squad sync infrastructure is in place (services/teamSyncService.js, services/squadSyncService.js) " +
      "and will activate automatically once real credentials are added to Vercel/GitHub secrets. Nothing was written.");
    return;
  }

  const canonicalTeams = readJson(TEAMS_PATH, []);
  const existingSquads = readJson(SQUADS_PATH, []);

  const fetchResult = await fetchCurrentSuperLigTeams();
  if (fetchResult.status !== "fetched") {
    console.error(`Team fetch failed: ${fetchResult.reason}. Canonical data left untouched.`);
    process.exitCode = 1;
    return;
  }

  const changeCheck = evaluateTeamListChange(canonicalTeams, fetchResult.teams);
  if (!changeCheck.safe) {
    console.error(`Team list change rejected: ${changeCheck.reason} (previous=${changeCheck.previousCount}, fetched=${changeCheck.fetchedCount}). No write performed.`);
    process.exitCode = 1;
    return;
  }

  const { merged: mergedTeams, additions, conflicts: teamConflicts } = mergeTeamList(canonicalTeams, fetchResult.teams);
  const activeTeams = mergedTeams.filter((team) => team.isCurrentSuperLigTeam);
  const targetTeams = args.team ? activeTeams.filter((team) => team.name === args.team) : activeTeams;

  console.log(`Team sync: ${additions.length} new team(s), ${teamConflicts.length} conflict(s), ${activeTeams.length} active team(s) total.`);

  const squadSnapshots = [];
  for (const team of targetTeams) {
    const squadResult = await fetchTeamSquad(team);
    const freshSnapshot = buildSquadSnapshot(team, squadResult.players, apiFootballProvider.getConfig().season);
    const previousSnapshot = existingSquads.find((snapshot) => snapshot.teamId === freshSnapshot.teamId);
    const safety = evaluateSquadSyncSafety(previousSnapshot, freshSnapshot);

    if (!safety.safe) {
      console.warn(`  ${team.name}: sync rejected (${safety.reason}), keeping previous snapshot.`);
      if (previousSnapshot) squadSnapshots.push(previousSnapshot);
      continue;
    }

    console.log(`  ${team.name}: ${freshSnapshot.status} (${freshSnapshot.players.length} players)`);
    squadSnapshots.push(freshSnapshot);
  }

  // Carry over snapshots for teams not targeted this run so a scoped --team run never drops others.
  for (const snapshot of existingSquads) {
    if (!squadSnapshots.some((item) => item.teamId === snapshot.teamId)) {
      squadSnapshots.push(snapshot);
    }
  }

  const playerConflicts = detectProviderIdConflicts(squadSnapshots);
  if (playerConflicts.length) {
    console.warn(`Provider ID conflicts detected (${playerConflicts.length}) — flagged for review, not auto-resolved:`);
    playerConflicts.forEach((conflict) => console.warn(`  - ${conflict.name} (${conflict.providerId}): ${conflict.teams.join(" vs ")}`));
  }

  if (!args.apply) {
    console.log("Dry run: no files written.");
    return;
  }

  atomicWrite(TEAMS_PATH, mergedTeams);
  atomicWrite(SQUADS_PATH, squadSnapshots);
  console.log(`Wrote ${path.relative(root, TEAMS_PATH)} and ${path.relative(root, SQUADS_PATH)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
