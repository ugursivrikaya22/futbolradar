import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { updatePlayerTransfer, validatePlayerData } = require("../services/playerService.js");

const root = process.cwd();
const playersPath = path.join(root, "data", "players.json");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = args.includes("--dry-run") || !apply;
const generatePages = args.includes("--generate-pages");
const jsonArg = args.find((arg) => arg.trim().startsWith("{"));

function argValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .trim()
    .toLowerCase();
}

function usage() {
  console.log([
    "Usage:",
    "  node scripts/update-player-transfers.mjs --apply --generate-pages '{\"playerSlug\":\"kerem-akturkoglu\",\"fromTeam\":\"Benfica\",\"toTeam\":\"Fenerbahce\",\"league\":\"Super Lig\",\"date\":\"2025-09-01\",\"type\":\"Bonservis\",\"feeEur\":22500000}'",
    "  node scripts/update-player-transfers.mjs --dry-run --player \"Kerem Akturkoglu\" --team \"Fenerbahce\" --season 2026",
    "  node scripts/update-player-transfers.mjs --apply --playerId kerem-akturkoglu --team \"Fenerbahce\" --generate-pages",
    "",
    "Without --apply this script runs in --dry-run mode. Keep real transfer changes in data/players.json."
  ].join("\n"));
}

function findPlayer(players, query) {
  const wanted = normalize(query);
  return players.find((player) => {
    return [player.id, player.slug, player.name, player.fullName]
      .filter(Boolean)
      .some((value) => normalize(value) === wanted);
  });
}

function buildUpdateFromArgs(players) {
  if (jsonArg) {
    return JSON.parse(jsonArg);
  }

  const player = findPlayer(players, argValue("--playerId") || argValue("--player"));
  const toTeam = argValue("--team");

  if (!player || !toTeam) {
    usage();
    process.exit(1);
  }

  return {
    playerSlug: player.id || player.slug,
    fromTeam: player.currentTeam || player.team,
    toTeam,
    currentTeam: toTeam,
    league: argValue("--league") || player.league,
    season: argValue("--season"),
    date: argValue("--date") || new Date().toISOString().slice(0, 10),
    type: argValue("--type") || "Manual update",
    source: "manual",
    dataStatus: argValue("--dataStatus") || "manual-review"
  };
}

if (args.includes("--help") || args.length === 0) {
  usage();
  process.exit(0);
}

const players = JSON.parse(fs.readFileSync(playersPath, "utf8"));
let update;

try {
  update = buildUpdateFromArgs(players);
} catch (error) {
  console.error(`Transfer update parse failed: ${error.message}`);
  process.exit(1);
}

let nextPlayers;
try {
  nextPlayers = updatePlayerTransfer(players, update);
} catch (error) {
  console.error(`Transfer update rejected: ${error.message}`);
  process.exit(1);
}
const result = validatePlayerData(nextPlayers);

if (!result.ok) {
  console.error(result.errors.map((error) => `ERROR ${error}`).join("\n"));
  process.exit(1);
}

const targetId = update.playerSlug || update.id || update.slug;
const before = players.find((player) => (player.id || player.slug) === targetId);
const after = nextPlayers.find((player) => (player.id || player.slug) === targetId);

if (dryRun) {
  console.log([
    "Dry run transfer update:",
    `  Player: ${before ? before.name : targetId}`,
    `  Current team: ${before ? before.currentTeam || before.team || "unknown" : "unknown"}`,
    `  Next team: ${after ? after.currentTeam || after.team || "unknown" : update.toTeam || update.currentTeam}`,
    `  Transfer date: ${update.date || "today"}`,
    "No file was changed. Re-run with --apply to write data/players.json."
  ].join("\n"));
  process.exit(0);
}

fs.writeFileSync(playersPath, `${JSON.stringify(nextPlayers, null, 2)}\n`, "utf8");
console.log(`Updated transfer for ${targetId}`);

if (generatePages) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "generate-player-profile-pages.mjs")], {
    cwd: root,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
