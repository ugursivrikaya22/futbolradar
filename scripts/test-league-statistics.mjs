import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  STAT_LEAGUES,
  statisticsFor,
  availableSeasons,
} from "./lib/leagueStatistics.mjs";
import { POSTPROCESS_CHAIN } from "./lib/postprocessChain.mjs";
const require = createRequire(import.meta.url);
const {
  isActiveStatsPlayer,
  filterActiveLeaderRows,
} = require("../services/playerStatsEligibility.js");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const leaders = read("data/competition-leaders.json"),
  standings = read("data/league-standings.json"),
  players = read("data/players.json");
assert.equal(isActiveStatsPlayer({ team: "Serbest oyuncu" }), false);
assert.equal(
  isActiveStatsPlayer({ team: "Kulüp", squadStatus: "released" }),
  false,
);
assert.equal(
  isActiveStatsPlayer({ team: "Kulüp", squadStatus: "injured" }),
  true,
);
assert.equal(
  isActiveStatsPlayer(
    { team: "Barcelona", isCurrentSuperLigPlayer: false },
    { superLigOnly: false },
  ),
  true,
);
assert.equal(
  isActiveStatsPlayer({ team: "Barcelona", isCurrentSuperLigPlayer: false }),
  false,
);
assert.equal(
  filterActiveLeaderRows(
    [{ providerId: "123", team: "Eski kulüp" }],
    [{ providerId: "123", team: "Serbest oyuncu", squadStatus: "released" }],
    { superLigOnly: false },
  ).length,
  0,
);
const l = STAT_LEAGUES[0],
  season = 2026;
const entry = structuredClone(leaders);
entry.cache["topscorers:39:2026"].rows.push({
  ...entry.cache["topscorers:39:2026"].rows[0],
  providerId: "999001",
  leagueId: "140",
});
entry.cache["topscorers:39:2026"].rows.push({
  ...entry.cache["topscorers:39:2026"].rows[0],
  providerId: "999002",
  season: 2025,
});
entry.cache["topscorers:39:2026"].rows.push({
  ...entry.cache["topscorers:39:2026"].rows[0],
  providerId: "999003",
  appearances: 0,
});
assert(
  !statisticsFor(l, season, entry, standings).scorers.rows.some((r) =>
    r.providerId.startsWith("999"),
  ),
);
assert.equal(statisticsFor(l, 2025, leaders, standings).indexable, false);
assert.equal(statisticsFor(l, 2025, leaders, standings).teams.length, 0);
const wrongSource = structuredClone(leaders);
wrongSource.source = "other";
assert.equal(
  statisticsFor(l, season, wrongSource, standings).scorers.rows.length,
  0,
);
const thin = structuredClone(leaders);
thin.cache["topscorers:39:2026"].rows = thin.cache[
  "topscorers:39:2026"
].rows.slice(0, 2);
assert.equal(statisticsFor(l, season, thin, standings).indexable, false);
const mismatched = structuredClone(leaders);
mismatched.cache["topscorers:39:2026"].competitionId = "la-liga";
assert.equal(
  statisticsFor(l, season, mismatched, standings).scorers.rows.length,
  0,
);
const archived = structuredClone(leaders);
archived.cache["topscorers:39:2025"] = {
  ...archived.cache["topscorers:39:2026"],
  season: 2025,
  rows: [],
};
assert.deepEqual(availableSeasons(l, archived, standings), [2026, 2025]);
execFileSync(
  process.execPath,
  ["scripts/generate-league-statistics-pages.mjs"],
  { stdio: "inherit" },
);
const snapshots = new Map();
for (const league of STAT_LEAGUES) {
  const html = fs.readFileSync(`${league.slug}-istatistikleri.html`, "utf8");
  snapshots.set(league.url, html);
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert(
    html.includes(
      `rel="canonical" href="https://www.futbolradar.com${league.url}"`,
    ),
  );
  assert(html.includes('Veri: <a href="https://www.api-football.com'));
  assert(!html.includes("TheSportsDB"));
  assert(!html.includes("Wikipedia"));
  assert(html.includes("Güncelleniyor. Kayıtlı API-Football"));
  const graph = JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
  )["@graph"];
  assert(graph.some((x) => x["@type"] === "BreadcrumbList"));
  assert.equal(graph.filter((x) => x["@type"] === "ItemList").length, 2);
  const stats = statisticsFor(league, 2026, leaders, standings, players);
  assert(stats.scorers.rows.length >= 5 && stats.assists.rows.length >= 5);
  assert(
    fs
      .readFileSync("sitemap.xml", "utf8")
      .includes(`<loc>https://www.futbolradar.com${league.url}</loc>`),
  );
  assert(
    fs
      .readFileSync(`${league.slug}-puan-durumu.html`, "utf8")
      .includes(`href="${league.url}"`),
  );
  assert(
    fs
      .readFileSync("istatistik-merkezi.html", "utf8")
      .includes(`href="${league.url}"`),
  );
  assert(
    read("vercel.json").rewrites.some(
      (r) => r.source === league.url && r.destination === `${league.url}.html`,
    ),
  );
  assert.equal(
    fs.readFileSync(`public/${league.slug}-istatistikleri.html`, "utf8"),
    html,
  );
}
for (const team of ["liverpool", "barcelona", "real-madrid", "atletico-madrid"])
  assert(
    fs
      .readFileSync(`takimlar/${team}.html`, "utf8")
      .includes("league-statistics:start"),
  );
assert(
  POSTPROCESS_CHAIN.findIndex((s) => s.id === "league-statistics") <
    POSTPROCESS_CHAIN.findIndex((s) => s.id === "shared-layout"),
);
execFileSync(process.execPath, [
  "scripts/generate-league-statistics-pages.mjs",
]);
for (const league of STAT_LEAGUES)
  assert.equal(
    fs.readFileSync(`${league.slug}-istatistikleri.html`, "utf8"),
    snapshots.get(league.url),
  );
console.log(
  "PASS: six hubs, provider/season isolation, active players, noindex policy, source/schema/routes, integration and idempotence",
);
