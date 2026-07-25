import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const {
  reconcileSquadPlayer,
  markDepartedPlayers,
  evaluatePlayerCountGuard,
  detectCanonicalDuplicates
} = require("../services/playerCanonicalService.js");
const { normalizeText } = require("../services/matchRadarService.js");

const PLAYERS_PATH = path.join(root, "data", "players.json");
const SQUADS_PATH = path.join(root, "data", "super-lig-squads.json");
const REVIEW_QUEUE_PATH = path.join(root, "data", "player-sync-review-queue.json");

function parseArgs(argv) {
  const args = { apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const squadSnapshots = readJson(SQUADS_PATH, []);

  if (!squadSnapshots.length) {
    console.log("No squad snapshots found at data/super-lig-squads.json (run scripts/sync-super-lig-squads.mjs first, " +
      "which itself requires a configured live provider). Nothing to merge — canonical player data left untouched.");
    return;
  }

  const rawPlayers = readJson(PLAYERS_PATH, []);
  const canonicalBefore = getPlayers(rawPlayers);
  const previousSuperLigCount = canonicalBefore.filter((player) => player.isCurrentSuperLigPlayer).length;

  let working = canonicalBefore.slice();
  const conflicts = [];
  const reviewQueue = [];
  const created = [];
  const activeSquadPlayerKeys = new Set();

  for (const snapshot of squadSnapshots) {
    const team = { name: snapshot.teamName, providerId: snapshot.teamId };
    for (const squadPlayer of snapshot.players || []) {
      const result = reconcileSquadPlayer(working, squadPlayer, team);

      if (result.action === "review") {
        reviewQueue.push(result);
        continue;
      }

      if (result.action === "create") {
        working.push(result.player);
        created.push(result.player.name);
        activeSquadPlayerKeys.add(result.player.providerId || result.player.id);
        continue;
      }

      const index = working.findIndex((player) => player.id === result.player.id);
      if (index !== -1) working[index] = result.player;
      activeSquadPlayerKeys.add(result.player.providerId || result.player.id);
      if (result.conflict) conflicts.push(result.conflict);
    }
  }

  working = markDepartedPlayers(working, activeSquadPlayerKeys);

  const duplicates = detectCanonicalDuplicates(working);
  if (duplicates.length) {
    console.error(`Duplicate detection failed: ${duplicates.length} duplicate(s) found. No write performed.`);
    duplicates.forEach((dup) => console.error(`  - ${dup.type}=${dup.value}: ${dup.players.join(" vs ")}`));
    process.exitCode = 1;
    return;
  }

  const newSuperLigCount = working.filter((player) => player.isCurrentSuperLigPlayer).length;
  const guard = evaluatePlayerCountGuard(previousSuperLigCount, newSuperLigCount);
  if (!guard.safe) {
    console.error(`Player count guard rejected the sync: ${guard.reason}. No write performed; canonical data preserved.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Reconciled ${squadSnapshots.length} squad snapshot(s): ${created.length} new player(s), ${conflicts.length} currentTeam conflict(s), ${reviewQueue.length} name-collision review item(s).`);
  console.log(`Current Süper Lig player count: ${previousSuperLigCount} -> ${newSuperLigCount}.`);
  if (conflicts.length) {
    console.log("Conflicts (kept local value, flagged for review):");
    conflicts.forEach((conflict) => console.log(`  - ${conflict.name}: local="${conflict.localValue}" provider="${conflict.providerValue}"`));
  }

  if (!args.apply) {
    console.log("Dry run: no files written.");
    return;
  }

  atomicWrite(PLAYERS_PATH, working);
  if (reviewQueue.length || conflicts.length) {
    atomicWrite(REVIEW_QUEUE_PATH, { generatedAt: new Date().toISOString(), conflicts, nameCollisions: reviewQueue });
    console.log(`Wrote ${path.relative(root, REVIEW_QUEUE_PATH)} (internal only — never synced to public/).`);
  }
  console.log(`Wrote ${path.relative(root, PLAYERS_PATH)}. Run "npm run build" to regenerate player profile pages, sitemap and public sync.`);
}

main();
