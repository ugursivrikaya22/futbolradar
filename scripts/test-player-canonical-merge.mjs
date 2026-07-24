import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { reconcileSquadPlayer, markDepartedPlayers, evaluatePlayerCountGuard, detectCanonicalDuplicates } = require("../services/playerCanonicalService.js");
const { getPlayers } = require("../services/playerService.js");

let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const canonicalPlayers = getPlayers(rawPlayers);

// --- Named-player protection: a hostile/incorrect provider payload must not move these three ---
{
  const kerem = canonicalPlayers.find((p) => p.name === "Kerem Aktürkoğlu");
  const ugurcan = canonicalPlayers.find((p) => p.name === "Uğurcan Çakır");
  const dzeko = canonicalPlayers.find((p) => p.name === "Edin Dzeko");
  expect(Boolean(kerem && ugurcan && dzeko), "expected seed data to contain Kerem/Ugurcan/Dzeko for this test");

  const keremResult = reconcileSquadPlayer(canonicalPlayers, { providerId: kerem.providerId, name: kerem.name, position: kerem.position }, { name: "Galatasaray" });
  expect(keremResult.player.currentTeam === "Fenerbahçe", `Kerem currentTeam must stay Fenerbahçe, got "${keremResult.player.currentTeam}"`);
  expect(Boolean(keremResult.conflict), "a conflicting team claim for Kerem must produce a conflict record, not a silent move");

  const ugurcanResult = reconcileSquadPlayer(canonicalPlayers, { providerId: ugurcan.providerId, name: ugurcan.name, position: ugurcan.position }, { name: "Fenerbahçe" });
  expect(ugurcanResult.player.currentTeam === "Galatasaray", `Uğurcan currentTeam must stay Galatasaray, got "${ugurcanResult.player.currentTeam}"`);
  expect(Boolean(ugurcanResult.conflict), "a conflicting team claim for Uğurcan must produce a conflict record");

  const dzekoResult = reconcileSquadPlayer(canonicalPlayers, { providerId: dzeko.providerId, name: dzeko.name, position: dzeko.position }, { name: "Galatasaray" });
  expect(dzekoResult.player.currentTeam !== "Galatasaray", "Dzeko must not become a current Süper Lig player from a single provider signal");
  expect(dzekoResult.player.currentTeam === "Schalke 04", `Dzeko currentTeam must stay Schalke 04, got "${dzekoResult.player.currentTeam}"`);
  expect(Boolean(dzekoResult.conflict), "a conflicting team claim for Dzeko must go through the conflict/review path, not silent overwrite");
}

// --- Same-name, different identity must go to review, never auto-merge ---
{
  const collision = reconcileSquadPlayer(canonicalPlayers, { providerId: "brand-new-provider-id-999", name: "Kerem Aktürkoğlu", position: "Forvet" }, { name: "Konyaspor" });
  // providerId differs from Kerem's real one, and no birthDate given -> should fall to name-only review, not silently create a duplicate or merge.
  expect(collision.action === "review", `a same-name different-providerId collision must route to review, got action="${collision.action}"`);
}

// --- Brand-new player with no canonical match is created cleanly ---
{
  const created = reconcileSquadPlayer(canonicalPlayers, { providerId: "new-player-123", name: "Test Yeni Oyuncu", position: "Orta saha" }, { name: "Samsunspor" });
  expect(created.action === "create", "an unmatched squad player must be created as a new canonical record");
  expect(created.player.currentTeam === "Samsunspor", "new player currentTeam must be the syncing team");
  expect(created.player.isCurrentSuperLigPlayer === true, "new player must be flagged as a current Süper Lig player");
}

// --- Departed players are flagged, never deleted ---
{
  const withFlag = canonicalPlayers.map((p) => ({ ...p, isCurrentSuperLigPlayer: true }));
  const activeKeys = new Set([withFlag[0].providerId || withFlag[0].id]);
  const result = markDepartedPlayers(withFlag, activeKeys);
  expect(result.length === withFlag.length, "markDepartedPlayers must never delete a profile");
  expect(result[0].isCurrentSuperLigPlayer === true, "the still-active player must remain active");
  expect(result.slice(1).every((p) => p.isCurrentSuperLigPlayer === false && p.squadStatus === "departed"), "all other players must be flagged departed, not removed");
}

// --- Count-drop guard ---
{
  expect(evaluatePlayerCountGuard(500, 450).safe === true, "a small drop (500->450) should be accepted");
  expect(evaluatePlayerCountGuard(500, 50).safe === false, "a >20% drop must be rejected");
  expect(evaluatePlayerCountGuard(0, 50).safe === false, "a result below the minimum safe threshold must be rejected even with no prior baseline");
}

// --- Duplicate detection ---
{
  const duplicated = [
    { providerId: "p1", slug: "a", name: "A" },
    { providerId: "p1", slug: "b", name: "B" }
  ];
  expect(detectCanonicalDuplicates(duplicated).length === 1, "a duplicate providerId across two records must be detected");
}

if (failures) {
  console.error(`\n${failures} player canonical merge check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("Player canonical merge checks passed (named-player protection, review routing, new-player creation, departed flagging, count-drop guard, duplicate detection).");
}
