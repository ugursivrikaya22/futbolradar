import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  fetchOfficialLineup,
  normalizeOfficialLineup,
  mergeOfficialLineup,
  compareProbableWithOfficial,
  computeLineupAccuracy,
  computeLineupRefreshTargets
} = require("../services/officialLineupService.js");

let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

async function main() {
  // --- no provider config -> unavailable, never fabricated ---
  {
    const result = await fetchOfficialLineup("fixture-1");
    expect(result.status === "unavailable" && result.reason === "no-provider-config", "fetchOfficialLineup must report unavailable when no provider is configured");
  }

  // --- normalize: no data yet -> pending, both sides empty ---
  {
    const normalized = normalizeOfficialLineup("fixture-1", { status: "pending", raw: [] });
    expect(normalized.status === "pending", "pending fetch result must normalize to status pending");
    expect(normalized.home.startingXI.length === 0 && normalized.away.startingXI.length === 0, "pending lineup must never contain fabricated players");
  }

  // --- normalize: real payload, dedup startingXI vs substitutes ---
  {
    const rawPayload = [
      {
        formation: "4-3-3",
        startXI: [{ player: { id: 1, name: "GK One", number: 1, pos: "G" } }, { player: { id: 2, name: "Def Two", number: 2, pos: "D" } }],
        substitutes: [{ player: { id: 2, name: "Def Two", number: 2, pos: "D" } }, { player: { id: 3, name: "Sub Three", number: 12, pos: "M" } }]
      },
      { formation: "4-4-2", startXI: [], substitutes: [] }
    ];
    const normalized = normalizeOfficialLineup("fixture-2", { status: "available", raw: rawPayload });
    expect(normalized.status === "available", "a real payload must normalize to status available");
    expect(normalized.home.startingXI.length === 2, "home startingXI must have 2 players");
    expect(normalized.home.substitutes.length === 1, "duplicate player (id 2) must be removed from substitutes, not double-listed");
    expect(normalized.home.substitutes[0].providerId === "3", "the remaining substitute must be the non-duplicate player");
  }

  // --- merge is additive: official lineup never erases an existing probable lineup ---
  {
    const matchAnalysis = { probableLineups: { home: { starters: [{ id: "p1", name: "Probable Player" }] }, away: {} }, officialLineups: { home: null, away: null } };
    const official = normalizeOfficialLineup("fixture-3", { status: "pending", raw: [] });
    const merged = mergeOfficialLineup(matchAnalysis, official);
    expect(Boolean(merged.probableLineups.home.starters.length), "probable lineup must remain untouched when official is still pending");
    expect(merged.officialLineups.home === null, "officialLineups must stay null while pending, not fabricated");
  }

  // --- accuracy only computed when official is actually available ---
  {
    const probable = { starters: [{ id: "1", name: "A" }, { id: "2", name: "B" }, { id: "99", name: "Z" }] };
    const noOfficial = { startingXI: [] };
    expect(computeLineupAccuracy(probable, noOfficial) === null, "accuracy must be null when there is no official lineup yet");

    const official = { startingXI: [{ providerId: "1", name: "A" }, { providerId: "2", name: "B" }, { providerId: "3", name: "C" }] };
    const comparison = compareProbableWithOfficial(probable, official);
    expect(comparison.available === true, "comparison must report available once official lineup exists");
    expect(comparison.matches === 2, `expected 2 correctly predicted starters, got ${comparison.matches}`);
    expect(comparison.accuracy === 67 || comparison.accuracy === 66, `expected ~67% accuracy (2/3), got ${comparison.accuracy}`);
    expect(comparison.unexpectedPlayers.includes("99"), "player 99 (in probable but not official) must be listed as unexpected");
  }

  // --- lineup refresh window targeting ---
  {
    const now = new Date("2026-07-24T12:00:00Z");
    const records = [
      { fixtureId: "too-far", status: "scheduled", officialLineupStatus: "unavailable", kickoff: "2026-07-25T12:00:00Z" },
      { fixtureId: "in-window", status: "scheduled", officialLineupStatus: "unavailable", kickoff: "2026-07-24T14:00:00Z" },
      { fixtureId: "already-have-it", status: "scheduled", officialLineupStatus: "available", kickoff: "2026-07-24T13:00:00Z" },
      { fixtureId: "already-live", status: "live", officialLineupStatus: "unavailable", kickoff: "2026-07-24T11:00:00Z" }
    ];
    const targets = computeLineupRefreshTargets(records, now);
    expect(targets.length === 1 && targets[0].fixtureId === "in-window", `expected exactly the in-window fixture, got ${JSON.stringify(targets.map((r) => r.fixtureId))}`);
  }

  if (failures) {
    console.error(`\n${failures} official-lineup check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("Official lineup checks passed (no fabrication when unavailable/pending, dedup, additive merge, accuracy gating, refresh window targeting).");
  }
}

main();
