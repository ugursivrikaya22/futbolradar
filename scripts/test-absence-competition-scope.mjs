// Ceza satırları yalnızca alındıkları turnuvanın maç sayfasında görünür;
// sakatlıklar turnuvadan bağımsız kalır ve cezalar "Cezalı/Suspended" etiketlenir.
import assert from "node:assert/strict";
import { absencesSectionHtml, absenceStatus, scopeAbsencesToCompetition } from "./lib/matchSeoPage.mjs";

const rows = [
  { playerName: "G. Guvenc", status: "injured", reason: "Muscle Injury", leagueId: "203" },
  { playerName: "L. Ugochukwu", status: "injured", reason: "Red Card", leagueId: "203" },
  { playerName: "X. Yellow", status: "suspended", reason: "Yellow Cards", leagueId: "2" },
  { playerName: "Legacy Ban", status: "suspended", reason: "Suspended" }
];

assert.equal(absenceStatus(rows[1]), "suspended");
assert.equal(absenceStatus(rows[0]), "injured");

assert.deepEqual(scopeAbsencesToCompetition(rows, "2").map((r) => r.playerName), ["G. Guvenc", "X. Yellow", "Legacy Ban"]);
assert.deepEqual(scopeAbsencesToCompetition(rows, "203").map((r) => r.playerName), ["G. Guvenc", "L. Ugochukwu", "Legacy Ban"]);
assert.deepEqual(scopeAbsencesToCompetition(rows, null).map((r) => r.playerName), ["G. Guvenc", "Legacy Ban"]);

const status = { teams: [{ team: "Galatasaray", absences: rows }] };
const tr = absencesSectionHtml(status, { locale: "tr", homeTeam: "Galatasaray", awayTeam: "Barcelona", competitionLeagueId: "203" });
assert.match(tr, /L\. Ugochukwu<\/b> <span class="msp-tag is-suspended">Cezalı/);
const trUcl = absencesSectionHtml(status, { locale: "tr", homeTeam: "Galatasaray", awayTeam: "Barcelona", competitionLeagueId: "2" });
assert.doesNotMatch(trUcl, /Ugochukwu/);
assert.match(trUcl, /G\. Guvenc/);
const en = absencesSectionHtml(status, { locale: "en", homeTeam: "Galatasaray", awayTeam: "Barcelona", competitionLeagueId: "203" });
assert.match(en, /L\. Ugochukwu<\/b> <span class="msp-tag is-suspended">Suspended/);

console.log("absence-competition-scope testleri geçti.");
