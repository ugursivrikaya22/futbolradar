import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { evaluateTeamListChange, mergeTeamList } = require("../services/teamSyncService.js");
const { buildSquadSnapshot, evaluateSquadSyncSafety, detectProviderIdConflicts, matchCanonicalPlayer } = require("../services/squadSyncService.js");

let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// --- Faz 2: team list change guard ---
{
  const previous = Array.from({ length: 18 }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` }));
  const fetchedFine = Array.from({ length: 17 }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` }));
  const fetchedCollapsed = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` }));
  const fetchedEmpty = [];

  expect(evaluateTeamListChange(previous, fetchedFine).safe === true, "small team-count drop (18->17) should be accepted");
  expect(evaluateTeamListChange(previous, fetchedCollapsed).safe === false, "large team-count drop (18->5) must be rejected");
  expect(evaluateTeamListChange(previous, fetchedEmpty).safe === false, "empty fetch result must be rejected");
}

// --- Faz 2: relegated team is flagged, never deleted ---
{
  const canonical = [
    { id: "galatasaray", name: "Galatasaray", providerId: "1", isCurrentSuperLigTeam: true },
    { id: "relegated-fc", name: "Relegated FC", providerId: "2", isCurrentSuperLigTeam: true }
  ];
  const fetched = [{ id: "1", providerId: "1", name: "Galatasaray" }, { id: "3", providerId: "3", name: "Promoted FC" }];
  const { merged, additions } = mergeTeamList(canonical, fetched);

  expect(merged.some((team) => team.name === "Relegated FC"), "relegated team profile must be preserved, not deleted");
  expect(merged.find((team) => team.name === "Relegated FC").isCurrentSuperLigTeam === false, "relegated team must be flagged inactive");
  expect(additions.length === 1 && additions[0].name === "Promoted FC", "promoted team must be added");
  expect(merged.find((team) => team.name === "Galatasaray").isCurrentSuperLigTeam === true, "still-active team must stay active");
}

// --- Faz 3: empty fetch never erases an existing squad ---
{
  const previousSnapshot = { teamId: "1", players: [{ providerId: "p1", name: "Player One" }, { providerId: "p2", name: "Player Two" }] };
  const emptyFresh = buildSquadSnapshot({ providerId: "1", name: "Team" }, [], 2026);
  const safety = evaluateSquadSyncSafety(previousSnapshot, emptyFresh);

  expect(safety.safe === false, "an empty fetch against a team with an existing squad must be rejected");
}

// --- Faz 3: partial vs complete squad status ---
{
  const smallSquad = buildSquadSnapshot({ providerId: "1", name: "Team" }, Array.from({ length: 5 }, (_, i) => ({ name: `P${i}` })), 2026);
  const fullSquad = buildSquadSnapshot({ providerId: "1", name: "Team" }, Array.from({ length: 24 }, (_, i) => ({ name: `P${i}` })), 2026);

  expect(smallSquad.status === "partial", "a 5-player squad must be marked partial, not complete");
  expect(fullSquad.status === "complete", "a 24-player squad must be marked complete");
}

// --- Faz 3: providerId conflict detection (same player active in two squads) ---
{
  const snapshots = [
    { teamId: "1", teamName: "Team A", players: [{ providerId: "p1", name: "Shared Player" }] },
    { teamId: "2", teamName: "Team B", players: [{ providerId: "p1", name: "Shared Player" }] }
  ];
  const conflicts = detectProviderIdConflicts(snapshots);
  expect(conflicts.length === 1, "a player active in two squads at once must be flagged as a conflict");
}

// --- Faz 3: identity resolution order (providerId > birthDate+name > name-only-review) ---
{
  const canonicalPlayers = [
    { providerId: "real-42", name: "Kerem Akturkoglu", birthDate: "1998-10-21" },
    { providerId: null, name: "Same Name Player", birthDate: "1990-01-01" }
  ];

  const byProviderId = matchCanonicalPlayer(canonicalPlayers, { providerId: "real-42", name: "Different Rendering" }, null);
  expect(byProviderId.method === "providerId" && byProviderId.match, "a providerId match must win even if the name differs");

  const byBirthAndName = matchCanonicalPlayer(canonicalPlayers, { providerId: "new-id", name: "Same Name Player" }, "1990-01-01");
  expect(byBirthAndName.method === "birthDate+name" && byBirthAndName.match, "birthDate+name should match when providerId is new");

  const nameOnly = matchCanonicalPlayer(canonicalPlayers, { providerId: "another-new-id", name: "Same Name Player" }, "1985-05-05");
  expect(nameOnly.method === "name-only-review-required" && !nameOnly.match, "a name-only collision with a different birth date must NOT auto-merge, only flag for review");
}

if (failures) {
  console.error(`\n${failures} squad-sync safety check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("Squad sync safety checks passed (team-count guard, relegation preservation, empty-fetch guard, partial/complete status, provider-id conflict detection, identity resolution order).");
}
