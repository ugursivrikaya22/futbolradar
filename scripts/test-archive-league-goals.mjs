/**
 * Arşiv lig gol dökümü kuralları:
 *   • kaçan penaltı gol sayılmaz, VAR satırı gol değildir;
 *   • olay yoksa maç "missing" (Gol detayı yok) olur, golcü türetilmez;
 *   • olay sayısı skorla tutmazsa "mismatch" olur;
 *   • belirsiz etiket kimliksiz maçı tahminle bir ülkeye atamaz.
 */
import assert from "node:assert/strict";
import { buildLeagueGoalPage, isScoringEvent, normalizeGoalEvent, LEAGUE_GOAL_PAGES } from "./lib/archiveLeagueGoals.mjs";

assert.equal(isScoringEvent({ type: "Goal", detail: "Normal Goal" }), true);
assert.equal(isScoringEvent({ type: "Goal", detail: "Penalty" }), true);
assert.equal(isScoringEvent({ type: "Goal", detail: "Own Goal" }), true);
assert.equal(isScoringEvent({ type: "Goal", detail: "Missed Penalty" }), false);
assert.equal(isScoringEvent({ type: "Var", detail: "Goal cancelled" }), false);
assert.equal(isScoringEvent({ type: "Gol", detail: "X skoru açtı." }), true);

const api = normalizeGoalEvent({ time: "71'", team: { name: "Trabzonspor" }, type: "Goal", detail: "Normal Goal", value: "M. Salah · Asist: Franculino · Normal Goal" });
assert.deepEqual([api.minute, api.player, api.team, api.assist], ["71'", "M. Salah", "Trabzonspor", "Franculino"]);
const manual = normalizeGoalEvent({ time: "-", team: { name: "Lyon" }, type: "Gol", detail: "Malick Fofana Lyon'un golünü attı." });
assert.equal(manual.minute, "", "eksik dakika boş kalır");
assert.equal(manual.player, "", "serbest metinden golcü ayıklanmaz");
assert.match(manual.note, /Fofana/);

const page = { slug: "t", title: "T", labels: ["Premier League"], ambiguous: true };
const matches = [
  { id: "a", league: "Premier League", kickoff: "2026-10-18", homeTeam: "A", awayTeam: "B", score: { home: 2, away: 0 } },
  { id: "b", league: "Premier League", kickoff: "2026-10-17", homeTeam: "C", awayTeam: "D", score: { home: 1, away: 0 } },
  { id: "c", league: "Premier League", kickoff: "2026-10-16", homeTeam: "E", awayTeam: "F", score: { home: 0, away: 0 } }
];
const sources = {
  byId: new Map([["a", { events: [{ time: "6'", team: { name: "A" }, type: "Goal", detail: "Normal Goal", value: "P · Normal Goal" }], eventSource: "api-football" }]]),
  leagueIdByMatch: new Map([["a", "39"]]),
  teamsByLabelLeague: new Map(),
  unapproved: new Set()
};
const result = buildLeagueGoalPage(page, matches, sources);
const byId = Object.fromEntries(result.rows.map((row) => [row.match.id, row]));
assert.equal(byId.a.status, "mismatch");
assert.equal(byId.b.status, "missing");
assert.equal(byId.b.goals.length, 0);
assert.equal(byId.c.status, "goalless");
assert.equal(byId.a.group, "id:39");
assert.equal(byId.b.group, null, "kimliksiz maç ülkeye atanmaz");
assert.equal(result.stats.archiveGoals, 3);
assert.equal(result.stats.goalEvents, 1);

const slugs = LEAGUE_GOAL_PAGES.map((entry) => entry.slug);
assert.equal(new Set(slugs).size, slugs.length);
const labels = LEAGUE_GOAL_PAGES.flatMap((entry) => entry.labels);
assert.equal(new Set(labels).size, labels.length, "bir etiket tek sayfaya bağlanır");

console.log("[test-archive-league-goals] ok");
