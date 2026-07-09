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
const generatePages = args.includes("--generate-pages");
const jsonArg = args.find((arg) => arg.trim().startsWith("{"));

function usage() {
  console.log([
    "Usage:",
    "  node scripts/update-player-transfers.mjs --apply --generate-pages '{\"playerSlug\":\"kerem-akturkoglu\",\"fromTeam\":\"Benfica\",\"toTeam\":\"Fenerbahçe\",\"league\":\"Süper Lig\",\"date\":\"2025-09-01\",\"type\":\"Bonservis\",\"feeEur\":22500000}'",
    "",
    "Without --apply this script only shows this help. Keep all transfer changes in data/players.json."
  ].join("\n"));
}

if (!apply || !jsonArg) {
  usage();
  process.exit(0);
}

let update;
try {
  update = JSON.parse(jsonArg);
} catch (error) {
  console.error(`Transfer JSON parse failed: ${error.message}`);
  process.exit(1);
}

const players = JSON.parse(fs.readFileSync(playersPath, "utf8"));
const nextPlayers = updatePlayerTransfer(players, update);
const result = validatePlayerData(nextPlayers);

if (!result.ok) {
  console.error(result.errors.map((error) => `ERROR ${error}`).join("\n"));
  process.exit(1);
}

fs.writeFileSync(playersPath, `${JSON.stringify(nextPlayers, null, 2)}\n`, "utf8");
console.log(`Updated transfer for ${update.playerSlug || update.id || update.slug}`);

if (generatePages) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "generate-player-profile-pages.mjs")], {
    cwd: root,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
