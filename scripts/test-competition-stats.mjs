#!/usr/bin/env node
/**
 * Stats centre (league-parameterised) — config, round mapping, fixtures sync
 * gating, form/round maths, client URL state, page generation and the
 * unchanged Süper Lig leaders table.
 *
 * Uses tests/fixtures/competition-stats/*.example.json — EXAMPLE DATA, not
 * real results — so it runs without APIFOOTBALL_API_KEY.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { leagueLeaderTableHtml } from "./lib/leaderTable.mjs";
import { refreshReason, syncCompetitionFixtures } from "./sync-competition-fixtures.mjs";
import { generateCompetitionStatsPages } from "./generate-competition-stats-pages.mjs";
import { SCORE_PATTERN, validateBlocks } from "./lib/structuredData.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const core = require("../competition-stats-core.js");
const statsLeagues = require("../services/statsLeagues.js");
const { normalizeFixture } = require("../services/providers/apiFootballProvider.js");
const fixturesDir = path.join(root, "tests", "fixtures", "competition-stats");
const readExample = (name) => JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed += 1; console.log(`  ✓ ${name}`); }, (error) => { console.error(`  ✗ ${name}`); throw error; });
}

console.log("competition-stats");

// ── Config ────────────────────────────────────────────────────────────────
await test("stats-leagues.json is valid and has Süper Lig, CL (2), EL (3)", () => {
  const leagues = statsLeagues.loadStatsLeagues({ root });
  const bySlug = Object.fromEntries(leagues.map((league) => [league.slug, league]));
  assert.equal(bySlug["super-lig"].apiId, 203);
  assert.equal(bySlug["sampiyonlar-ligi"].apiId, 2);
  assert.equal(bySlug["avrupa-ligi"].apiId, 3);
  assert.equal(bySlug["sampiyonlar-ligi"].pages.tr.stats, "sampiyonlar-ligi-istatistikleri");
  assert.equal(bySlug["avrupa-ligi"].pages.en.stats, "en/europa-league-stats");
  assert.deepEqual(statsLeagues.validateConfig({ leagues: [{ slug: "X", apiId: 0, season: "x", name: {}, leadersSource: "nope", rounds: [{ key: "a" }] }] }).length > 3, true);
});

await test("UEFA rounds: league phase (not group stage) and the knockout ladder", () => {
  for (const slug of ["sampiyonlar-ligi", "avrupa-ligi"]) {
    const league = statsLeagues.getStatsLeague(slug, { root });
    const keys = league.rounds.map((round) => round.key);
    assert.deepEqual(keys, ["eleme", "lig-asamasi", "play-off", "son-16", "ceyrek-final", "yari-final", "final"]);
    assert.ok(!JSON.stringify(league.rounds).toLowerCase().includes("group"), "no group stage round");
    assert.equal(league.rounds.find((round) => round.key === "lig-asamasi").matchdays, 8);
  }
});

await test("API-Football round labels map to site rounds; unknown labels are kept, not dropped", () => {
  const league = statsLeagues.getStatsLeague("sampiyonlar-ligi", { root });
  const labels = readExample("api-football-rounds.example.json").response;
  const mapped = Object.fromEntries(labels.map((label) => [label, statsLeagues.mapRound(label, league)]));
  assert.equal(mapped["League Stage - 3"].key, "lig-asamasi");
  assert.equal(mapped["League Stage - 3"].matchday, 3);
  assert.equal(mapped["League Stage - 8"].matchday, 8);
  assert.equal(mapped["Knockout Round Play-offs"].key, "play-off");
  assert.equal(mapped["Play-offs"].key, "eleme", "qualifying play-off is not the knockout play-off");
  assert.equal(mapped["Round of 16"].key, "son-16");
  assert.equal(mapped["Quarter-finals"].key, "ceyrek-final");
  assert.equal(mapped["Semi-finals"].key, "yari-final");
  assert.equal(mapped["Final"].key, "final");
  assert.equal(mapped["1st Qualifying Round"].key, "eleme");
  assert.equal(mapped["Mystery Round"].known, false);
  assert.equal(mapped["Mystery Round"].key, "diger-mystery-round");
  assert.equal(labels.filter((label) => !mapped[label].known).length, 1);
});

await test("season auto: July cut-over, label 2026-27", () => {
  const league = statsLeagues.getStatsLeague("sampiyonlar-ligi", { root });
  assert.equal(statsLeagues.resolveSeason(league, new Date("2026-10-19T12:00:00Z")), 2026);
  assert.equal(statsLeagues.resolveSeason(league, new Date("2027-05-30T12:00:00Z")), 2026);
  assert.equal(statsLeagues.resolveSeason(league, new Date("2027-07-02T12:00:00Z")), 2027);
  assert.equal(statsLeagues.seasonLabel(2026), "2026-27");
});

// ── Fixtures sync (mock provider, example data) ──────────────────────────
const rawFixtures = readExample("api-football-fixtures.example.json");
const rawRounds = readExample("api-football-rounds.example.json");
function mockProvider(overrides = {}) {
  const calls = [];
  return {
    calls,
    normalizeFixture,
    async providerFetch(pathName, params) {
      calls.push({ pathName, params });
      if (overrides.fail) throw new Error("PROVIDER_DOWN");
      if (pathName === "/fixtures/rounds") return { response: rawRounds.response };
      if (pathName === "/fixtures") return { response: overrides.empty ? [] : String(params.league) === "2" ? rawFixtures.response : [] };
      throw new Error(`unexpected ${pathName}`);
    }
  };
}
const NOW = new Date("2026-10-19T12:00:00Z");
const clOnly = [statsLeagues.getStatsLeague("sampiyonlar-ligi", { root })];
let exampleStore;

await test("sync: two requests per league, raw round label kept, unknown labels reported", async () => {
  const provider = mockProvider();
  const result = await syncCompetitionFixtures({ provider, now: NOW, previous: { cache: {} }, leagues: clOnly });
  assert.deepEqual(provider.calls.map((call) => call.pathName), ["/fixtures/rounds", "/fixtures"]);
  assert.deepEqual(provider.calls[1].params, { league: 2, season: 2026, timezone: "Europe/Istanbul" });
  const entry = result.cache["fixtures:2:2026"];
  assert.equal(entry.fixtures.length, 8);
  assert.equal(entry.fixtures[1].roundLabel, "League Stage - 1");
  assert.equal(entry.fixtures[1].status, "FINISHED");
  assert.deepEqual(entry.unknownRounds, ["Mystery Round"]);
  exampleStore = { ...result, example: true };
});

await test("sync gating: fresh cache → zero requests; result due / stale / missing → refresh", async () => {
  const entry = exampleStore.cache["fixtures:2:2026"];
  assert.equal(refreshReason(undefined, NOW), "missing");
  assert.equal(refreshReason({ ...entry, fetchedAt: "2026-10-18T20:00:00Z" }, NOW), "stale");
  assert.equal(refreshReason({ ...entry, fetchedAt: "2026-10-19T11:50:00Z" }, NOW), null, "younger than 30 min");
  assert.equal(refreshReason({ ...entry, fetchedAt: "2026-10-19T09:00:00Z" }, NOW), null, "nothing due");
  const due = { ...entry, fetchedAt: "2026-10-21T20:00:00Z" };
  assert.equal(refreshReason(due, new Date("2026-10-21T21:30:00Z")), "result-due");
  const provider = mockProvider();
  await syncCompetitionFixtures({ provider, now: new Date("2026-10-19T12:10:00Z"), previous: { cache: exampleStore.cache }, leagues: clOnly });
  assert.equal(provider.calls.length, 0);
});

await test("sync: empty or failed response never replaces the previous entry", async () => {
  const later = new Date("2026-10-20T12:00:00Z");
  for (const overrides of [{ empty: true }, { fail: true }]) {
    const result = await syncCompetitionFixtures({ provider: mockProvider(overrides), now: later, previous: { cache: exampleStore.cache }, leagues: clOnly });
    assert.equal(result.cache["fixtures:2:2026"], exampleStore.cache["fixtures:2:2026"]);
  }
});

// ── Payload + maths ──────────────────────────────────────────────────────
const exampleLeaders = readExample("competition-leaders.example.json");
const league = clOnly[0];
const payload = statsLeagues.buildPagePayload(league, { root, now: NOW, locale: "tr", fixturesStore: exampleStore, leadersStore: exampleLeaders });

await test("payload: teams from league phase (qualifier-only club excluded), example flag carried", () => {
  assert.equal(payload.example, true);
  assert.deepEqual(payload.teams.map((team) => team.name), ["Example Club A", "Example Club B", "Example Club C", "Example Club D"]);
  assert.equal(payload.teams[0].slug, "example-club-a");
  assert.deepEqual(payload.unknownRoundLabels, ["Mystery Round"]);
  assert.equal(payload.scorers[0].teamId, "90001");
});

await test("round summary: default scope excludes qualifying", () => {
  const summary = core.roundSummary(core.selectFixtures(payload, { roundKey: "", matchday: null, teamId: null }));
  assert.equal(summary.total, 7);
  assert.equal(summary.finished, 4);
  assert.equal(summary.goals, 12);
  assert.equal(summary.avgGoals, 3);
  assert.equal(summary.homeWins, 1);
  assert.equal(summary.draws, 2);
  assert.equal(summary.awayWins, 1);
  assert.equal(summary.btts, 3);
  assert.equal(summary.biggest.id, "990002");
  const md2 = core.roundSummary(core.selectFixtures(payload, { roundKey: "lig-asamasi", matchday: 2, teamId: null }));
  assert.equal(md2.finished, 2);
  assert.equal(md2.goals, 6);
  const quali = core.selectFixtures(payload, { roundKey: "eleme", matchday: null, teamId: null });
  assert.equal(quali.length, 1);
  const md3 = core.roundSummary(core.selectFixtures(payload, { roundKey: "lig-asamasi", matchday: 3, teamId: null }));
  assert.equal(md3.finished, 0);
  assert.equal(md3.avgGoals, null, "no invented average for unplayed rounds");
});

await test("form table: last-5 from finished fixtures only", () => {
  const rows = core.formTable(payload, core.selectFixtures(payload, { roundKey: "" }), { last: 5 });
  assert.deepEqual(rows.map((row) => row.team.name), ["Example Club A", "Example Club C", "Example Club D", "Example Club B"]);
  const a = rows[0];
  assert.deepEqual([a.played, a.won, a.drawn, a.lost, a.gf, a.ga], [2, 1, 1, 0, 5, 3]);
  assert.deepEqual(a.last.map((item) => item.code), ["W", "D"]);
  const onlyB = core.formTable(payload, core.selectFixtures(payload, { roundKey: "" }), { teamId: "90002" });
  assert.equal(onlyB.length, 1);
  assert.deepEqual(onlyB[0].last.map((item) => item.code), ["L", "L"]);
});

await test("URL state round-trips (TR ?takim=&tur=, EN ?team=&round=); junk is ignored", () => {
  const state = core.parseState("?takim=example-club-c&tur=lig-asamasi-2", payload);
  assert.deepEqual(state, { teamId: "90003", roundKey: "lig-asamasi", matchday: 2 });
  assert.equal(core.buildSearch(state, payload), "?takim=example-club-c&tur=lig-asamasi-2");
  assert.deepEqual(core.parseState("?takim=nope&tur=lig-asamasi-99", payload), { teamId: null, roundKey: "", matchday: null });
  assert.deepEqual(core.parseState("?tur=play-off", payload), { teamId: null, roundKey: "play-off", matchday: null });
  const en = statsLeagues.buildPagePayload(league, { root, now: NOW, locale: "en", fixturesStore: exampleStore, leadersStore: exampleLeaders });
  const enState = core.parseState("?team=example-club-a&round=round-of-16", en);
  assert.deepEqual(enState, { teamId: "90001", roundKey: "son-16", matchday: null });
  assert.equal(core.buildSearch(enState, en), "?team=example-club-a&round=round-of-16");
});

await test("leaders filter by team; empty states never say 'Veri yok'", () => {
  const html = core.leadersTableHtml(payload, "goals", { teamId: "90004" });
  assert.match(html, /Example Striker Two/);
  assert.doesNotMatch(html, /Example Striker One/);
  const none = core.leadersTableHtml(payload, "assists", { teamId: "90004" });
  assert.match(none, /ilk 20/);
  const empty = statsLeagues.buildPagePayload(league, { root, now: NOW, locale: "tr", fixturesStore: { cache: {} }, leadersStore: { cache: {} } });
  const all = core.leadersTableHtml(empty, "goals", {}) + core.formTableHtml(empty, {}) + core.roundStatsHtml(empty, {});
  assert.match(all, /Veri bekleniyor/);
  assert.match(all, /Güncelleniyor/);
  assert.doesNotMatch(all, /Veri\s+yok/i);
});

// ── Page generation ──────────────────────────────────────────────────────
await test("generator (example data): banner, noindex, canonical, hreflang, JSON-LD", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cs-pages-"));
  const written = generateCompetitionStatsPages({ out, now: NOW.toISOString(), noSitemap: true, fixturesStore: exampleStore, leadersStore: exampleLeaders });
  assert.deepEqual(written.map((page) => page.path).sort(), ["avrupa-ligi-istatistikleri.html", "en/champions-league-stats.html", "en/europa-league-stats.html", "sampiyonlar-ligi-istatistikleri.html"]);
  const tr = fs.readFileSync(path.join(out, "sampiyonlar-ligi-istatistikleri.html"), "utf8");
  assert.match(tr, /ÖRNEK VERİ/);
  assert.match(tr, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(tr, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/sampiyonlar-ligi-istatistikleri" \/>/);
  assert.match(tr, /hreflang="en" href="https:\/\/www\.futbolradar\.com\/en\/champions-league-stats"/);
  assert.match(tr, /hreflang="x-default" href="https:\/\/www\.futbolradar\.com\/sampiyonlar-ligi-istatistikleri"/);
  const ld = JSON.parse(tr.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const types = ld["@graph"].map((node) => node["@type"]);
  assert.deepEqual(types, ["CollectionPage", "BreadcrumbList", "ItemList"]);
  for (const node of ld["@graph"]) assert.ok(!SCORE_PATTERN.test(JSON.stringify(node)), "no scores in structured data");
  assert.deepEqual(validateBlocks([ld]).errors, [], "repo structured-data rules");
  const data = JSON.parse(tr.match(/<script type="application\/json" id="competition-stats-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.example, true);
  assert.match(tr, /Lig aşaması · 3\. maç günü/);
  const en = fs.readFileSync(path.join(out, "en", "champions-league-stats.html"), "utf8");
  assert.match(en, /<html lang="en">/);
  assert.match(en, /EXAMPLE DATA/);
  assert.match(en, /League phase · Matchday 3/);
  assert.doesNotMatch(en, /Veri bekleniyor|Güncelleniyor|Lig aşaması/);
});

await test("generator (repo data): real leaders, honest 'Güncelleniyor' until fixtures sync", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cs-pages-real-"));
  const written = generateCompetitionStatsPages({ out, noSitemap: true });
  for (const page of written) {
    const html = fs.readFileSync(path.join(out, page.path), "utf8");
    assert.doesNotMatch(html, /ÖRNEK VERİ|EXAMPLE DATA/);
    assert.doesNotMatch(html, /Example Club/);
    if (!page.payload.fixtures.length) assert.match(html, page.locale === "en" ? /Updating/ : /Güncelleniyor/);
  }
});

// ── Süper Lig: same output as before the refactor ────────────────────────
await test("Süper Lig leaders table unchanged by the league-config refactor", () => {
  // Reference: the pre-refactor implementation from prerender-core-pages.mjs.
  const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const initials = (name) => { const clean = String(name || "").trim(); if (!clean) return "?"; const parts = clean.split(/\s+/).filter(Boolean); return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || clean.charAt(0).toUpperCase(); };
  const href = (slug) => `./futbolcu/${slug}`;
  const logo = (row) => { const i = esc(initials(row.team)); if (!row.teamLogo) return `<span class="home-standing-logo home-standing-logo-fallback" aria-hidden="true">${i}</span>`; return `<span class="home-standing-logo-wrap"><img class="home-standing-logo" src="${esc(row.teamLogo)}" alt="" width="20" height="20" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="home-standing-logo-fallback" aria-hidden="true" style="display:none">${i}</span></span>`; };
  const name = (row) => { const n = esc(row.name || ""); return row.slug ? `<a href="${esc(href(row.slug))}">${n}</a>` : `<span>${n}</span>`; };
  const legacy = (rows, metric, metricLabel) => {
    if (!rows || !rows.length) return `<article class="card data-empty" data-card="empty-state"><strong>${esc("Veri bekleniyor")}</strong><span>${esc(`Süper Lig ${metricLabel.toLocaleLowerCase("tr-TR")} sıralaması, resmî lig maçları oynandıkça güncellenir.`)}</span></article>`;
    const body = rows.map((row) => `<tr>
              <td>${esc(String(row.rank))}</td>
              <th scope="row">${name(row)}</th>
              <td><span class="home-standing-team">${logo(row)}<span>${esc(row.team || "")}</span></span></td>
              <td><strong>${esc(String(row[metric] ?? 0))}</strong></td>
              <td>${row.appearances ? esc(String(row.appearances)) : "-"}</td>
            </tr>`).join("");
    return `<div class="evergreen-table-wrap"><table class="evergreen-table">
          <thead><tr><th scope="col">Sıra</th><th scope="col">Oyuncu</th><th scope="col">Takım</th><th scope="col">${esc(metricLabel)}</th><th scope="col">Maç</th></tr></thead>
          <tbody>${body}</tbody>
        </table></div>`;
  };
  const superLig = statsLeagues.getStatsLeague("super-lig", { root });
  const leaders = statsLeagues.leadersFor(superLig, { root });
  const options = { league: superLig, playerHref: href };
  assert.ok(leaders.scorers.length > 0, "repo carries real Süper Lig leaders");
  assert.equal(leagueLeaderTableHtml(leaders.scorers, "goals", "Gol", options), legacy(leaders.scorers, "goals", "Gol"));
  assert.equal(leagueLeaderTableHtml(leaders.assists, "assists", "Asist", options), legacy(leaders.assists, "assists", "Asist"));
  assert.equal(leagueLeaderTableHtml([], "goals", "Gol", options), legacy([], "goals", "Gol"));
});

console.log(`competition-stats: ${passed} checks passed`);
