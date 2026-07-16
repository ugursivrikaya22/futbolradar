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
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));

const kerem = getPlayerBySlug("kerem-akturkoglu", players, { atDate: "2026-07-13" });
const ugurcan = getPlayerBySlug("ugurcan-cakir", players, { atDate: "2026-07-13" });
const dzeko = getPlayerBySlug("edin-dzeko", players, { atDate: "2026-07-13" });
const icardi = getPlayerBySlug("mauro-icardi", players, { atDate: "2026-07-16" });

assert.equal(kerem.currentTeam, "Fenerbahçe");
assert.equal(kerem.currentTeamId, "fenerbahce");
assert.equal(ugurcan.currentTeam, "Galatasaray");
assert.equal(dzeko.currentTeam, "Schalke 04");
assert.match(dzeko.league, /Bundesliga/i);
assert.equal(icardi.currentTeam, "Serbest oyuncu");
assert.equal(icardi.transferHistory.at(-1).toTeam, "Serbest oyuncu");
assert.ok(transfers.length >= 10, "confirmed transfer feed must contain the current transfer window");
assert.ok(transfers.every((transfer) => transfer.status === "confirmed"), "rumours must not enter the confirmed transfer feed");
assert.ok(transfers.some((transfer) => transfer.playerName === "Lesley Ugochukwu" && transfer.toTeam === "Galatasaray"));
assert.ok(transfers.some((transfer) => transfer.playerName === "Leandro Trossard" && transfer.toTeam === "Beşiktaş"));
assert.ok(transfers.some((transfer) => transfer.playerName === "Vedat Muriqi" && transfer.toTeam === "Fenerbahçe"));

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

assert.throws(
  () => updatePlayerTransfer(players, { playerSlug: "missing-player", toTeam: "Test Spor" }, "2026-07-13"),
  /Oyuncu bulunamadi/,
  "missing players must not result in a silent successful transfer"
);
assert.throws(
  () => updatePlayerTransfer(players, {
    playerSlug: "kerem-akturkoglu",
    fromTeam: "Yanlis Takim",
    toTeam: "Test Spor",
    date: "2026-07-13"
  }, "2026-07-13"),
  /currentTeam ile uyusmuyor/,
  "conflicting source clubs must require an explicit override"
);
assert.throws(
  () => updatePlayerTransfer(players, {
    playerSlug: "kerem-akturkoglu",
    toTeam: "Test Spor",
    date: "2020-01-01"
  }, "2026-07-13"),
  /son kayittan eski/,
  "backdated transfers must not silently replace the current club"
);

const incomplete = normalizePlayer({
  id: "incomplete-player",
  name: "Eksik Oyuncu",
  currentTeam: "Test SK",
  position: "Forvet",
  staleAfter: "2026-01-01T00:00:00Z"
}, { atDate: "2026-07-13" });
assert.equal(incomplete.stats.goals, null, "missing goals must stay unknown");
assert.equal(incomplete.stats.minutesPlayed, null, "missing minutes must stay unknown");
assert.equal(incomplete.isStale, true, "expired player records must be marked stale");
assert.equal(incomplete.needsReview, true, "expired player records must require review");

console.log("FutbolRadar player data tests passed");
