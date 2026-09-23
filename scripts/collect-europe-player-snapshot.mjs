// Runs inside the repository's CI account. Credentials never enter the artifact.
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const leagues = { "premier-league": [39, 20], "la-liga": [140, 20], "serie-a": [135, 20], bundesliga: [78, 18], "ligue-1": [61, 18] };
const league = process.env.SNAPSHOT_LEAGUE || "premier-league";
const scope = process.env.SNAPSHOT_SCOPE || "all";
if (!["all", "recent"].includes(scope)) throw new Error("Invalid snapshot scope");
const season = Number(process.env.SNAPSHOT_SEASON || new Date().getUTCFullYear());
if (!leagues[league] || !Number.isInteger(season)) throw new Error("Invalid league or season");
const [leagueId, teamCount] = leagues[league];
const apiKey = process.env.APIFOOTBALL_API_KEY;
if (!apiKey) throw new Error("Provider credential is unavailable in CI");
const snapshot = { schemaVersion: 1, source: "api-football", league, season, scope, startedAt: new Date().toISOString(), runUrl: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`, complete: false, responses: {} };
let requests = 0;
let remaining = null;
function keyFor(url) { url.searchParams.sort(); return url.pathname + url.search; }
async function request(endpoint, params) {
  if (requests >= 220 || (remaining !== null && remaining <= 25)) throw new Error("Provider quota safety stop");
  const url = new URL(endpoint, "https://v3.football.api-sports.io");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const key = keyFor(url);
  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(1100);
    requests++;
    const res = await fetch(url, { headers: { "x-apisports-key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    const payload = await res.json();
    const value = res.headers.get("x-ratelimit-requests-remaining");
    remaining = value === null ? null : Number(value);
    const errors = Object.values(payload.errors || {}).filter(Boolean).join("; ");
    if ((res.status === 429 || /per minute|too many requests/i.test(errors)) && attempt < 2) { await delay(61000); continue; }
    if (!res.ok || errors) throw new Error(`${key}: HTTP ${res.status}; ${errors || "provider request failed"}`);
    if (!Array.isArray(payload.response)) throw new Error(`${key}: invalid provider response`);
    snapshot.responses[key] = { fetchedAt: new Date().toISOString(), payload };
    console.log(`${key}: ${payload.response.length} rows`);
    return payload;
  }
}
try {
  const meta = await request("/leagues", { id: leagueId, season });
  const current = meta.response.find((r) => r.league.id === leagueId)?.seasons.find((s) => s.year === season && s.current);
  if (!current) throw new Error(`${league}: provider does not confirm the ${season}/${season + 1} current season`);
  const teams = scope === "all" ? await request("/teams", { league: leagueId, season }) : { response: [] };
  if (scope === "all" && teams.response.length !== teamCount) throw new Error(`Expected ${teamCount} teams, received ${teams.response.length}`);
  for (const row of teams.response) {
    const squad = await request("/players/squads", { team: row.team.id });
    if (squad.response[0]?.players?.length < 11) throw new Error(`Incomplete squad: ${row.team.id}`);
  }
  if (current.coverage.players !== false) {
    for (let page = 1; page <= 80; page++) {
      const players = await request("/players", { league: leagueId, season, page });
      if (players.paging.current !== page || !Number.isInteger(players.paging.total) || players.paging.total < page || players.paging.total > 80) throw new Error("Invalid player pagination");
      if (page === players.paging.total) break;
    }
  }
  for (const row of teams.response) await request("/transfers", { team: row.team.id });
  if (scope === "all" && current.coverage.injuries !== false) await request("/injuries", { league: leagueId, season });
  if (scope === "all" && current.coverage.standings !== false) await request("/standings", { league: leagueId, season });
  const fixtures = await request("/fixtures", { league: leagueId, season });
  const finished = fixtures.response.filter((m) => ["FT", "AET", "PEN"].includes(m.fixture.status.short) && Date.parse(m.fixture.date) <= Date.now()).sort((a, b) => b.fixture.date.localeCompare(a.fixture.date)).slice(0, 50);
  for (const match of finished) await request("/fixtures/players", { fixture: match.fixture.id });
  snapshot.complete = true;
} catch (error) {
  snapshot.error = error.message;
  process.exitCode = 1;
} finally {
  snapshot.finishedAt = new Date().toISOString();
  snapshot.requests = requests;
  fs.mkdirSync("outputs/europe-provider-snapshot", { recursive: true });
  fs.writeFileSync(`outputs/europe-provider-snapshot/${league}.json`, JSON.stringify(snapshot));
  console.log(JSON.stringify({ league, season, complete: snapshot.complete, requests, remaining, error: snapshot.error }));
}
