import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  PRIMARY_COMPETITION_IDS,
  SCOREBOARD_COMPETITION_IDS,
  primaryCompetitions,
  scoreboardCompetitions
} = require("../services/competitionCatalog");
const {
  dateInTimeZone,
  dedupeMatches,
  normalizeMatchRecord
} = require("../services/matchDataService");
const { getMatchDataProvider } = require("../services/providers");

assert.deepEqual(PRIMARY_COMPETITION_IDS, [
  "super-lig",
  "premier-league",
  "la-liga",
  "serie-a",
  "bundesliga",
  "ligue-1"
], "Score surface must use the six canonical leagues in a stable order");
assert.equal(primaryCompetitions().length, 6, "All six primary competitions must resolve from the catalog");
assert.deepEqual(SCOREBOARD_COMPETITION_IDS, [
  ...PRIMARY_COMPETITION_IDS,
  "sampiyonlar-ligi",
  "avrupa-ligi",
  "konferans-ligi",
  "hazirlik-maclari"
], "Score surface must include the six leagues, UEFA competitions and friendlies");
assert.equal(scoreboardCompetitions().length, 10, "All scoreboard competitions must resolve from the catalog");

assert.equal(
  dateInTimeZone("2026-07-21T22:30:00Z", "Europe/Istanbul"),
  "2026-07-22",
  "UTC kickoff must roll over correctly in Europe/Istanbul"
);

const liveMatch = normalizeMatchRecord({
  id: "live-1",
  league: "Premier League",
  kickoff: "2026-07-22T19:00:00Z",
  homeTeam: "Home",
  awayTeam: "Away",
  homeTeamLogo: "https://media.example.test/home.png",
  awayTeamLogo: "javascript:alert(1)",
  status: "2H",
  minute: 67,
  score: { home: 2, away: 1, halftimeHome: 1, halftimeAway: 0 },
  events: [
    { type: "Card", detail: "Red Card", team: { name: "Away" }, time: { elapsed: 64 }, player: "Player" },
    { type: "Goal", detail: "Normal Goal", team: { name: "Home" }, time: { elapsed: 66 }, player: "Scorer" }
  ],
  source: "api-football"
});
assert.equal(liveMatch.status, "LIVE", "Live provider status must normalize to LIVE");
assert.equal(liveMatch.homeTeamLogo, "https://media.example.test/home.png", "Secure provider crest URL must survive normalization");
assert.equal(liveMatch.awayTeamLogo, null, "Unsafe team crest URL must be rejected");
assert.deepEqual(liveMatch.halfTimeScore, { home: 1, away: 0 }, "Half-time score must be preserved");
assert.equal(liveMatch.events[0].eventType, "card", "Provider event must use the common event schema");
assert.equal(liveMatch.events[0].card, "red", "Red-card detail must be normalized");
assert.equal(liveMatch.events[1].eventType, "goal", "Goal event must be normalized");
assert.deepEqual(liveMatch.redCards, { home: 0, away: 1 }, "Red cards must be counted by team");

const finished = normalizeMatchRecord({
  id: "finished-1",
  league: "Serie A",
  kickoff: "2026-07-20T19:00:00Z",
  homeTeam: "A",
  awayTeam: "B",
  status: "FT",
  score: { home: 1, away: 1 },
  source: "api-football"
});
assert.equal(finished.status, "FINISHED", "Finished provider status must remain final");
assert.equal(dedupeMatches([finished, { ...finished, fetchedAt: "2026-07-22T10:00:00Z" }]).length, 1, "Duplicate fixtures must collapse to one record");
assert.equal(normalizeMatchRecord({
  id: "friendly-1",
  competitionId: "hazirlik-maci",
  league: "Hazırlık Maçı",
  kickoff: "2026-07-24T18:00:00Z",
  homeTeam: "A",
  awayTeam: "B"
}).competitionId, "hazirlik-maclari", "Singular friendly competition identifiers must resolve to the canonical catalog id");

const provider = getMatchDataProvider("matches");
for (const method of ["fetchFixturesByDate", "fetchLiveFixtures", "fetchFixtureDetails", "fetchMatchEvents", "fetchStandings"]) {
  assert.equal(typeof provider[method], "function", `${method} must exist on the provider adapter`);
}

const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(indexHtml, /class="score-home"/, "Homepage must use the score-first surface");
assert.match(indexHtml, /data-score-search/, "Homepage search control is missing");
assert.match(indexHtml, /data-score-period="live"/, "Live/today/tomorrow tabs are missing");
assert.match(indexHtml, /data-score-league="premier-league"/, "Primary league filter is missing");
assert.match(indexHtml, /data-score-league="sampiyonlar-ligi"/, "Champions League filter is missing");
assert.match(indexHtml, /data-score-league="avrupa-ligi"/, "Europa League filter is missing");
assert.match(indexHtml, /data-score-league="konferans-ligi"/, "Conference League filter is missing");
assert.match(indexHtml, /data-score-league="hazirlik-maclari"/, "Friendly match filter is missing");
assert.match(indexHtml, /data-score-list/, "Server-rendered match container is missing");
assert.match(indexHtml, /data-score-sync-status/, "Provider synchronization state is missing");
assert.match(indexHtml, /score-home\.js/, "Lightweight homepage script is missing");
assert.doesNotMatch(indexHtml, /src="\.\/app\.js"/, "The heavy application bundle must not block the score-first homepage");
assert.doesNotMatch(indexHtml, /Veri kaynağı/i, "Homepage must not expose a provider/source label");

const clientJs = fs.readFileSync(path.join(root, "score-home.js"), "utf8");
assert.match(clientJs, /\/api\/matches\?mode=live/, "Live endpoint request is missing");
assert.match(clientJs, /URLSearchParams/, "Filter state must be reflected in the URL");
assert.match(clientJs, /function currentDateInIstanbul/, "Homepage date must refresh in the browser without requiring a daily deployment");
assert.match(clientJs, /data-team-logo/, "Homepage client must render provider team crests");
assert.match(clientJs, /function safeLogoUrl/, "Homepage client must validate provider crest URLs");
assert.match(clientJs, /data-score-search-results/, "Search result behavior is missing");
assert.match(clientJs, /Canlı maç verisine şu anda ulaşılamıyor/, "Provider errors need a distinct user state");
assert.match(clientJs, /Şu anda seçili turnuvalarda canlı maç bulunmuyor/, "A true no-live-match state is missing");
assert.match(clientJs, /Son başarılı güncelleme:/, "Stale data must expose the last successful update");

const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
assert.match(appJs, /function initGeneratedMatchTabs/, "Match detail tab controller is missing");
assert.match(appJs, /Maç detayı bölümleri/, "Match detail tabs need an accessible label");
assert.match(appJs, /apiParams\.set\("mode", "live"\)/, "Live-score page must call the dedicated live endpoint mode");

for (const page of ["bugunun-maclari.html", "canli-skor.html"]) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  assert.doesNotMatch(html, /13 Temmuz 2026/, `${page} must not contain the obsolete hard-coded verification date`);
  assert.match(html, /data-last-match-check/, `${page} must expose a dynamic verification timestamp hook`);
}

const curatedMatches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const today = dateInTimeZone(new Date().toISOString(), "Europe/Istanbul");
const currentCuratedMatches = dedupeMatches(curatedMatches).filter((match) => dateInTimeZone(match.kickoffAtUtc, "Europe/Istanbul") === today);
const todayPage = fs.readFileSync(path.join(root, "bugunun-maclari.html"), "utf8");
for (const match of currentCuratedMatches) {
  assert.match(todayPage, new RegExp(match.homeTeam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Today's verified fallback is missing ${match.homeTeam}`);
  assert.match(todayPage, new RegExp(match.awayTeam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Today's verified fallback is missing ${match.awayTeam}`);
}

const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
assert.match(css, /\.score-bottom-nav/, "Mobile bottom navigation styles are missing");
assert.match(css, /\.score-team-logo/, "Simple score cards must reserve stable team crest dimensions");
assert.match(css, /\.simple-score-card/, "Secondary score pages must use the simplified card surface");
assert.match(css, /@media \(max-width: 640px\)/, "Mobile score layout breakpoint is missing");

for (const competition of primaryCompetitions()) {
  const file = path.join(root, "lig", competition.id, "index.html");
  assert.ok(fs.existsSync(file), `League page is missing: ${competition.id}`);
  const html = fs.readFileSync(file, "utf8");
  assert.match(html, new RegExp(`<h1>${competition.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`), `${competition.name} H1 is missing`);
  assert.match(html, /"@type":"BreadcrumbList"/, `${competition.name} breadcrumb schema is missing`);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/lig\//, `${competition.name} canonical is missing`);
  for (const heading of ["Canlı maçlar", "Bugünün maçları", "Yaklaşan maçlar", "Son sonuçlar", "Puan durumu", "Lig analizleri"]) {
    assert.match(html, new RegExp(heading), `${competition.name} league hub is missing ${heading}`);
  }
}

const sitemap = [
  fs.readFileSync(path.join(root, "sitemap.xml"), "utf8"),
  fs.readFileSync(path.join(root, "sitemaps", "competitions.xml"), "utf8")
].join("\n");
for (const competition of primaryCompetitions()) {
  assert.match(sitemap, new RegExp(`/lig/${competition.id}/`), `${competition.name} must be present in the competition sitemap`);
}

const generatedManifest = JSON.parse(fs.readFileSync(path.join(root, "data", "generated-match-pages.json"), "utf8"));
const generatedMatch = (generatedManifest.matches || []).find((item) => fs.existsSync(path.join(root, "mac", item.slug, "index.html")));
if (generatedMatch) {
  const matchHtml = fs.readFileSync(path.join(root, "mac", generatedMatch.slug, "index.html"), "utf8");
  assert.match(matchHtml, /"@type":"SportsEvent"/, "Permanent match page must retain SportsEvent schema");
}

console.log("Score-first homepage, league pages, normalization and technical SEO tests passed.");
