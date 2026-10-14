// Oynanmış hafta fikstürü, takvim penceresinden düşse bile arşivdeki
// doğrulanmış sonuçla eşleşir; sonuç yoksa hiçbir şey uydurulmaz.
import assert from "node:assert/strict";
import { findFinalResult, resultRowsFrom } from "./lib/enMatchResult.mjs";

const fixture = { homeTeam: "Trabzonspor", awayTeam: "Galatasaray", round: 6, kickoff: null };
const archive = [{
  lastVerifiedAt: "2026-10-02T17:04:00.247Z",
  match: { homeTeam: "Trabzonspor", awayTeam: "Galatasaray", league: "Süper Lig", status: "FINISHED", providerStatus: "FT", kickoff: "2026-09-19T20:00:00+03:00", score: { home: 4, away: 0, halftimeHome: null, halftimeAway: null } }
}, {
  // Rövanş (ters sıra) ve hazırlık maçı eşleşmemeli.
  match: { homeTeam: "Galatasaray", awayTeam: "Trabzonspor", league: "Süper Lig", status: "FINISHED", providerStatus: "FT", kickoff: "2027-02-01T20:00:00+03:00", score: { home: 1, away: 1 } }
}, {
  match: { homeTeam: "Trabzonspor", awayTeam: "Galatasaray", league: "Club Friendlies", status: "FINISHED", providerStatus: "FT", kickoff: "2026-07-20T20:00:00+03:00", score: { home: 0, away: 2 } }
}];

// Takvimde artık yok (pencere dışı) → arşivsiz sonuç bulunmaz.
assert.equal(findFinalResult(fixture, [], { seasonStart: "2026-08-14" }), null);
const result = findFinalResult(fixture, resultRowsFrom([], archive), { seasonStart: "2026-08-14" });
assert.equal(result.home, 4);
assert.equal(result.away, 0);
assert.equal(result.kickoff, "2026-09-19T20:00:00+03:00");
assert.equal(result.finishKey, "regular");

// Arşivde kaydı olmayan fikstür önizleme kalır.
assert.equal(findFinalResult({ homeTeam: "Göztepe", awayTeam: "Gençlerbirliği" }, resultRowsFrom([], archive), { seasonStart: "2026-08-14" }), null);
// Yarım skorlu arşiv kaydı sonuç sayılmaz.
const half = [{ match: { ...archive[0].match, score: { home: 4, away: null } } }];
assert.equal(findFinalResult(fixture, resultRowsFrom([], half), { seasonStart: "2026-08-14" }), null);

console.log("played-round-result testleri geçti.");
