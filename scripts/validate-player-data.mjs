import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validatePlayerData } = require("../services/playerService.js");

const root = process.cwd();
const playersPath = path.join(root, "data", "players.json");
const players = JSON.parse(fs.readFileSync(playersPath, "utf8"));
const result = validatePlayerData(players);

if (result.warnings.length) {
  console.warn(result.warnings.map((warning) => `WARN ${warning}`).join("\n"));
}

if (!result.ok) {
  console.error(result.errors.map((error) => `ERROR ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Player data validation passed: ${players.length} players`);
