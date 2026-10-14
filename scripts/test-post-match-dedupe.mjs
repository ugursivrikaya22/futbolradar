// Sağlayıcı kopyası (aynı maç, iki fikstür kimliği) ve başlama saati
// gelmemiş "bitmiş" kayıt maç sonu raporu almaz; gerçek farklı maçlar kalır.
import assert from "node:assert/strict";
import { dropProviderDuplicates, isWalkoverWithoutScore } from "./lib/postMatchDedupe.mjs";

const nowMs = Date.parse("2026-10-13T08:45:00Z");
const base = { homeTeam: "Chile W", awayTeam: "Bolivia W", homeTeamId: "1977", awayTeamId: "16924", status: "FINISHED", score: { home: 7, away: 0 } };
const first = { ...base, id: "chile-w-bolivia-w-2026-10-12", kickoff: "2026-10-12T00:00:00+03:00", providerIds: { apiFootball: "1644445" } };
const sameKickoffCopy = { ...base, id: "chile-w-bolivia-w-2026-10-13", kickoff: "2026-10-12T00:00:00+03:00", providerIds: { apiFootball: "1644444" } };
const redatedCopy = { ...base, id: "chile-w-bolivia-w-2026-10-13", kickoff: "2026-10-13T09:00:00+03:00", providerIds: { apiFootball: "1644444" } };
const futureCopy = { ...base, id: "chile-w-bolivia-w-2026-10-13", kickoff: "2026-10-13T23:00:00+03:00", providerIds: { apiFootball: "1644444" } };
const laterRealMatch = { ...base, id: "chile-w-bolivia-w-2026-10-08", kickoff: "2026-10-08T00:00:00+03:00", score: { home: 2, away: 1 }, providerIds: { apiFootball: "1" } };
const other = { ...base, id: "x-y-2026-10-12", homeTeam: "X", awayTeam: "Y", homeTeamId: "5", awayTeamId: "6", kickoff: "2026-10-12T00:00:00+03:00", providerIds: { apiFootball: "9" } };

for (const copy of [sameKickoffCopy, redatedCopy, futureCopy]) {
  const result = dropProviderDuplicates([copy, first, laterRealMatch, other], { nowMs });
  assert.deepEqual(result.matches.map((m) => m.id).sort(), [first.id, laterRealMatch.id, other.id].sort());
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].providerId, "1644444");
}
// Aynı kimlik iki kez gelirse ayıklanmaz: yinelenen başlık koruması yakalar.
assert.equal(dropProviderDuplicates([first, { ...first }], { nowMs }).matches.length, 2);
// Hükmen 0-0: oynanmamış maç, rapor yok.
const walkover = { homeTeam: "Morocco W", awayTeam: "Congo W", homeTeamId: "1", awayTeamId: "2", id: "morocco-w-congo-w-2026-10-13", kickoff: "2026-10-13T22:00:00+03:00", status: "AWARDED", providerStatus: "WO", score: { home: 0, away: 0 }, providerIds: { apiFootball: "1645471" } };
assert.equal(isWalkoverWithoutScore(walkover), true);
assert.equal(isWalkoverWithoutScore({ ...walkover, score: { home: 3, away: 0 } }), false);
const laterNow = Date.parse("2026-10-14T08:00:00Z");
let res = dropProviderDuplicates([walkover], { nowMs: laterNow });
assert.equal(res.matches.length, 0);
assert.equal(res.dropped[0].reason, "walkover-no-score");

// Çelişen kayıt: oynanan maç "iptal" + aynı skor, iptal edilen maç "FT".
const fakeFt = { ...base, id: "chile-w-bolivia-w-2026-10-13", kickoff: "2026-10-12T00:00:00+03:00", providerIds: { apiFootball: "1644444" } };
const cancelled = { ...base, id: "chile-w-bolivia-w-2026-10-12", kickoff: "2026-10-13T23:00:00+03:00", status: "CANCELLED", providerStatus: "CANC", providerIds: { apiFootball: "1644445" } };
res = dropProviderDuplicates([fakeFt, other], { nowMs: laterNow, allMatches: [fakeFt, cancelled, other] });
assert.deepEqual(res.matches.map((m) => m.id), [other.id]);
assert.equal(res.dropped[0].reason, "contradicted-by-cancelled");
// Skoru olmayan gerçek bir iptal, bitmiş maçı düşürmez.
res = dropProviderDuplicates([fakeFt], { nowMs: laterNow, allMatches: [fakeFt, { ...cancelled, score: { home: null, away: null } }] });
assert.equal(res.matches.length, 1);

console.log("post-match-dedupe testleri geçti.");
