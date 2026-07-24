import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const { detectCanonicalDuplicates } = require("../services/playerCanonicalService.js");
const { normalizeText } = require("../services/matchRadarService.js");

const failures = [];
const warnings = [];
function expect(condition, message) {
  if (!condition) failures.push(message);
}
function warnIf(condition, message) {
  if (condition) warnings.push(message);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const teams = readJson(path.join(root, "data", "teams.json"), []);
const rawPlayers = readJson(path.join(root, "data", "players.json"), []);
const matches = readJson(path.join(root, "data", "matches.json"), []);
const players = getPlayers(rawPlayers);

// 1-3: squad-level structural checks (hard failures — data corruption, not coverage gaps).
const duplicates = detectCanonicalDuplicates(players);
expect(duplicates.length === 0, `Duplicate providerId/slug detected across canonical players: ${JSON.stringify(duplicates)}`);

// 4-5: same player must not be marked active/current in two different teams at once.
{
  const activePlayers = players.filter((player) => player.isCurrentSuperLigPlayer !== false);
  const byIdentity = new Map();
  for (const player of activePlayers) {
    const key = player.providerId || player.id;
    const teamsForKey = byIdentity.get(key) || new Set();
    teamsForKey.add(normalizeText(player.currentTeam));
    byIdentity.set(key, teamsForKey);
  }
  const multiTeamPlayers = [...byIdentity.entries()].filter(([, teamSet]) => teamSet.size > 1);
  expect(multiTeamPlayers.length === 0, `Player(s) appear active in more than one team simultaneously: ${JSON.stringify(multiTeamPlayers)}`);
}

// 6: reasonable per-team squad size (soft — sparse data is a known, documented state today).
{
  const teamNames = new Set(teams.map((team) => normalizeText(team.name)));
  const countByTeam = new Map();
  players.forEach((player) => {
    const key = normalizeText(player.currentTeam);
    if (!teamNames.has(key)) return;
    countByTeam.set(key, (countByTeam.get(key) || 0) + 1);
  });
  for (const team of teams) {
    const count = countByTeam.get(normalizeText(team.name)) || 0;
    warnIf(count < 11, `${team.name}: only ${count} known player(s) — below a usable starting-XI count.`);
  }
}

// 7: fixture providerId must be unique where present.
{
  const seen = new Map();
  for (const match of matches) {
    const key = match.providerId || match.id;
    if (!key) continue;
    if (seen.has(key) && seen.get(key) !== match.id) {
      failures.push(`Duplicate fixture identity: ${key} used by both "${seen.get(key)}" and "${match.id}"`);
    }
    seen.set(key, match.id);
  }
}

if (warnings.length) {
  console.warn(`Coverage warnings (${warnings.length}, non-blocking):`);
  warnings.forEach((message) => console.warn(`  - ${message}`));
}

if (failures.length) {
  console.error(`\nfootball-coverage validation failed with ${failures.length} issue(s):`);
  failures.forEach((message) => console.error(`  - ${message}`));
  process.exit(1);
}

console.log(`football-coverage structural validation passed for ${players.length} player(s), ${teams.length} team(s), ${matches.length} fixture(s).`);
