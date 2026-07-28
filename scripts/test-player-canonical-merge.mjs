import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const {
  reconcileSquadPlayer,
  markDepartedPlayers,
  evaluatePlayerCountGuard,
  detectCanonicalDuplicates,
  detectUnmergedProviderTwins
} = require("../services/playerCanonicalService.js");
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

// --- Unmerged provider twins: the duplicate the hard gate cannot see ---
{
  // Editoryal kayıt tam ad + yer tutucu kimlik, sağlayıcı kaydı kısaltılmış
  // ad + gerçek kimlik. Ne providerId ne slug çakışıyor; sert kapı bunu
  // görmüyor, inceleme kuyruğu görmeli.
  const roster = [
    { id: "victor-osimhen", slug: "victor-osimhen", name: "Victor Osimhen", providerId: "mock-victor-osimhen", currentTeam: "Galatasaray" },
    { id: "v-osimhen-galatasaray", slug: "v-osimhen-galatasaray", name: "V. Osimhen", providerId: "2780", currentTeam: "Galatasaray" }
  ];
  expect(detectCanonicalDuplicates(roster).length === 0, "the hard duplicate gate must stay quiet: neither providerId nor slug collides");

  const twins = detectUnmergedProviderTwins(roster);
  expect(twins.length === 1, "an editorial record and its provider twin must be reported once");
  expect(twins[0].confidence === "high", "matching first initials must be reported as high confidence");
  expect(twins[0].placeholder.id === "victor-osimhen", "the placeholder side must be the record carrying the mock provider id");
  expect(twins[0].providerBacked.providerId === "2780", "the provider-backed side must carry the real numeric id");
}

{
  // İki ayrı futbolcu aynı soyadını taşıyabilir. İkisi de gerçek sağlayıcı
  // kimliğine sahipse bu bir kopya değil; kuyruğa girmemeli.
  const brothers = [
    { id: "deniz-aydogdu-eyupspor", name: "Deniz Aydogdu", providerId: "630293", currentTeam: "Eyüpspor" },
    { id: "eren-aydogdu-eyupspor", name: "Eren Aydogdu", providerId: "630294", currentTeam: "Eyüpspor" }
  ];
  expect(detectUnmergedProviderTwins(brothers).length === 0, "two provider-backed players sharing a surname must not be reported as twins");
}

{
  // Aynı soyadı, farklı takım: aynı oyuncu değil.
  const differentTeams = [
    { id: "a-player", name: "Ali Kaya", providerId: "mock-ali-kaya", currentTeam: "Samsunspor" },
    { id: "b-player", name: "A. Kaya", providerId: "44444", currentTeam: "Trabzonspor" }
  ];
  expect(detectUnmergedProviderTwins(differentTeams).length === 0, "same surname at different clubs must not be reported as a twin");
}

{
  // Baş harf tutmuyorsa eşleşme atılmaz ama "high" da denmez: sağlayıcı
  // kısaltmaları her zaman ilk addan türemiyor.
  const abbreviated = [
    { id: "michael-murillo", name: "Michael Murillo", providerId: "mock-michael-murillo", currentTeam: "Beşiktaş" },
    { id: "a-murillo-besiktas", name: "A. Murillo", providerId: "2973", currentTeam: "Beşiktaş" }
  ];
  const twins = detectUnmergedProviderTwins(abbreviated);
  expect(twins.length === 1, "a surname match with mismatched initials must still surface for review");
  expect(twins[0].confidence === "review", "mismatched initials must be downgraded to review confidence, never asserted as high");
}

if (failures) {
  console.error(`\n${failures} player canonical merge check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("Player canonical merge checks passed (named-player protection, review routing, new-player creation, departed flagging, count-drop guard, duplicate detection, unmerged provider twins).");
}
