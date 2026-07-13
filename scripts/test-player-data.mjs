import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const {
  getPlayerBySlug,
  normalizePlayer,
  updatePlayerTransfer,
  validatePlayerData
} = require("../services/playerService.js");
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));

const kerem = getPlayerBySlug("kerem-akturkoglu", players, { atDate: "2026-07-13" });
const ugurcan = getPlayerBySlug("ugurcan-cakir", players, { atDate: "2026-07-13" });
const dzeko = getPlayerBySlug("edin-dzeko", players, { atDate: "2026-07-13" });

assert.equal(kerem.currentTeam, "Fenerbahçe");
assert.equal(kerem.currentTeamId, "fenerbahce");
assert.equal(ugurcan.currentTeam, "Galatasaray");
assert.equal(dzeko.currentTeam, "Schalke 04");
assert.match(dzeko.league, /Bundesliga/i);

const minimal = { id: "test-player", name: "Test Player", currentTeam: "Test SK", position: "Forvet", rating: 70 };
assert.deepEqual(normalizePlayer(minimal), normalizePlayer(minimal), "normalization must not create clock-based values");

const moved = updatePlayerTransfer(players, {
  playerSlug: "kerem-akturkoglu",
  toTeam: "Test Spor",
  league: "Test Lig",
  date: "2026-07-13",
  source: "manual"
}, "2026-07-13");
const movedKerem = getPlayerBySlug("kerem-akturkoglu", moved, { atDate: "2026-07-13" });
assert.equal(movedKerem.currentTeam, "Test Spor");
assert.equal(movedKerem.currentTeamId, "test-spor");
assert.ok(movedKerem.formerTeams.includes("Fenerbahçe"));
assert.equal(movedKerem.transferHistory.at(-1).toTeam, "Test Spor");
assert.equal(movedKerem.lastUpdatedAt, "2026-07-13");
assert.ok(validatePlayerData(moved, { enforceKnownTransfers: false }).ok, "transfer update must preserve a valid player collection");

console.log("FutbolRadar player data tests passed");
