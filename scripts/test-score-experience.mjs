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
assert.deepEqual(
  normalizeMatchRecord(normalizeMatchRecord(liveMatch)).redCards,
  { home: 0, away: 1 },
  "Repeated match normalization must not multiply red-card totals."
);

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
const staleScheduledRevision = {
  ...finished,
  status: "SCHEDULED",
  score: { home: null, away: null },
  fetchedAt: "2026-07-23T10:00:00Z",
  lastVerifiedAt: "2026-07-23T10:00:00Z"
};
const protectedFinal = dedupeMatches([finished, staleScheduledRevision])[0];
assert.equal(protectedFinal.status, "FINISHED", "A newer empty schedule must not overwrite a verified final result");
assert.deepEqual(protectedFinal.score, { home: 1, away: 1 }, "A verified final score must survive stale provider data");

const mergedRichMatch = dedupeMatches([
  {
    id: "official-rich-match",
    competitionId: "avrupa-ligi",
    league: "UEFA Avrupa Ligi",
    kickoff: "2026-07-23T21:00:00+03:00",
    homeTeam: "Beşiktaş",
    awayTeam: "FC Midtjylland",
    status: "FINISHED",
    score: { home: 1, away: 0 },
    events: [{ type: "Gol" }, { type: "Maç sonu" }],
    statistics: [],
    source: "official_club",
    lastVerifiedAt: "2026-07-23T20:45:00Z"
  },
  {
    id: "provider-rich-match",
    competitionId: "avrupa-ligi",
    league: "UEFA Europa League",
    kickoff: "2026-07-23T21:00:00+03:00",
    homeTeam: "Beşiktaş",
    awayTeam: "FC Midtjylland",
    status: "FINISHED",
    score: { home: 1, away: 0 },
    events: [],
    statistics: [{ type: "Ball Possession", home: "53%", away: "47%" }],
    source: "api-football",
    lastVerifiedAt: "2026-07-23T21:05:00Z"
  }
]);
assert.equal(mergedRichMatch[0].events.length, 2, "A newer provider record must not erase richer verified events.");
assert.equal(mergedRichMatch[0].statistics.length, 1, "Provider statistics should enrich the merged match.");
const dateOnlyResult = {
  id: "verified-date-only",
  competitionId: "konferans-ligi",
  league: "UEFA Konferans Ligi",
  kickoff: "2026-07-23",
  kickoffPrecision: "date",
  homeTeam: "Malisheva",
  awayTeam: "Hibernian",
  status: "FINISHED",
  score: { home: 2, away: 0 },
  source: "verified-result-archive"
};
const timedProviderResult = {
  ...dateOnlyResult,
  id: "provider-timed",
  providerId: "848-100",
  kickoff: "2026-07-23T18:00:00Z",
  kickoffPrecision: "datetime",
  source: "api-football"
};
assert.equal(
  dedupeMatches([dateOnlyResult, timedProviderResult]).length,
  1,
  "A date-only verified result must merge with its later timed provider record."
);
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
assert.match(indexHtml, /class="[^"]*\bscore-home\b[^"]*"/, "Homepage must use the score-first surface");
assert.match(indexHtml, /data-score-search/, "Homepage search control is missing");
assert.match(indexHtml, /data-score-period="live"/, "Live/today/tomorrow tabs are missing");
assert.match(indexHtml, /data-score-period="yesterday"/, "Finished matches need a yesterday shortcut.");
assert.match(indexHtml, /data-score-league="premier-league"/, "Primary league filter is missing");
assert.match(indexHtml, /data-score-league="sampiyonlar-ligi"/, "Champions League filter is missing");
assert.match(indexHtml, /data-score-league="avrupa-ligi"/, "Europa League filter is missing");
assert.match(indexHtml, /data-score-league="konferans-ligi"/, "Conference League filter is missing");
assert.match(indexHtml, /data-score-league="hazirlik-maclari"/, "Friendly match filter is missing");
assert.match(indexHtml, /data-score-list/, "Server-rendered match container is missing");
assert.match(indexHtml, /data-score-sync-status/, "Provider synchronization state is missing");
assert.match(indexHtml, /score-home\.js/, "Lightweight homepage script is missing");
assert.match(indexHtml, /class="score-discovery"/, "Compact discovery links are missing");
assert.match(indexHtml, /href="\.\/transfer-radari\.html"/, "Transfer search landing link is missing");
assert.match(indexHtml, /href="\.\/oyuncu-radari\.html"/, "Player Radar link is missing");
assert.match(indexHtml, /href="\.\/uefa-ulke-puani-siralamasi\.html"/, "UEFA country ranking link is missing");
assert.match(indexHtml, /takim-detay\.html\?team=Fenerbah%C3%A7e/, "Popular team link is missing");
assert.match(indexHtml, /"@type":"ItemList"/, "Popular destinations need ItemList structured data");
assert.doesNotMatch(indexHtml, /id="shortcut-title">Hızlı erişim/, "Homepage must not render the old shortcut card wall");
assert.doesNotMatch(indexHtml, /src="\.\/app\.js"/, "The heavy application bundle must not block the score-first homepage");
assert.doesNotMatch(indexHtml, /Veri kaynağı/i, "Homepage must not expose a provider/source label");

const clientJs = fs.readFileSync(path.join(root, "score-home.js"), "utf8");
assert.match(clientJs, /matchesUrl\(\{\s*mode: "live"\s*\}\)/, "Live endpoint request must include shared timezone parameters");
assert.match(clientJs, /includeFriendlies", "true"/, "Daily match requests must include friendly fixtures by default");
assert.match(clientJs, /URLSearchParams/, "Filter state must be reflected in the URL");
assert.match(clientJs, /function currentDateInIstanbul/, "Homepage date must refresh in the browser without requiring a daily deployment");
assert.match(clientJs, /Dünün sonuçları/, "The score-first homepage must keep yesterday's completed matches one tap away.");
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
assert.match(appJs, /eventsSection\.innerHTML/, "Live match details must refresh the event panel.");
assert.match(appJs, /statisticsSection\.innerHTML/, "Live match details must refresh the statistics panel.");
assert.match(appJs, /if \(!String\(value \|\| ""\)\.trim\(\)\) return "";/, "Blank team logo values must not resolve to the current page URL.");
assert.match(appJs, /DATA_ROOT \+ "matches-cache\.json"/, "Match fallback must include the verified result cache.");
assert.match(appJs, /var fixtureDate = matchDateValue\(match\)/, "Client match merging must collapse timezone variants on the same fixture date.");

for (const page of ["bugunun-maclari.html", "canli-skor.html"]) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  assert.doesNotMatch(html, /13 Temmuz 2026/, `${page} must not contain the obsolete hard-coded verification date`);
  assert.match(html, /data-last-match-check/, `${page} must expose a dynamic verification timestamp hook`);
}

const curatedMatches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const cachedMatches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches-cache.json"), "utf8"));
const europaResults = cachedMatches.filter((match) =>
  match.competitionId === "avrupa-ligi" &&
  dateInTimeZone(match.kickoffAtUtc, "Europe/Istanbul") === "2026-07-23"
);
assert.equal(europaResults.length, 9, "The verified 23 July Europa League snapshot must contain all nine matches.");
assert.equal(europaResults.every((match) =>
  match.status === "FINISHED" && match.score && match.score.home !== null && match.score.away !== null
), true, "Every synchronized Europa League result must have a final score.");
assert.equal(europaResults.filter((match) => Array.isArray(match.statistics) && match.statistics.length).length, 8, "Available provider statistics must be preserved without fabricating the missing match.");
assert.equal(europaResults.every((match) => Array.isArray(match.lineups) && match.lineups.length === 2), true, "Every synchronized match must retain both lineups.");
const conferenceResults = cachedMatches.filter((match) =>
  match.competitionId === "konferans-ligi" &&
  dateInTimeZone(match.kickoffAtUtc, "Europe/Istanbul") === "2026-07-23"
);
assert.equal(conferenceResults.length, 40, "The verified 23 July Conference League archive must contain all 40 finished matches.");
assert.equal(conferenceResults.every((match) =>
  match.status === "FINISHED" && match.score && match.score.home !== null && match.score.away !== null
), true, "Every archived Conference League result must have a final score.");
assert.equal(
  conferenceResults.every((match) => Array.isArray(match.statistics) && match.statistics.length === 0),
  true,
  "Unavailable Conference League statistics must remain empty instead of being fabricated."
);
assert.equal(
  conferenceResults.every((match) => match.analysis && match.analysis.disclaimer),
  true,
  "Every score-only result needs a transparent analysis disclaimer."
);
const conferenceMatchPage = path.join(root, "mac", "malisheva-hibernian-2026-07-23", "index.html");
assert.equal(fs.existsSync(conferenceMatchPage), true, "A permanent Conference League result page must be generated.");
const conferenceMatchHtml = fs.readFileSync(conferenceMatchPage, "utf8");
assert.match(conferenceMatchHtml, /23 Temmuz 2026/, "Date-only verified results must render their confirmed calendar date.");
assert.doesNotMatch(conferenceMatchHtml, /<h2>Tarih doÄŸrulanmadÄ±<\/h2>/, "A confirmed date-only result must not be labelled as unverified.");
const besiktasResult = curatedMatches.find((match) => match.id === "besiktas-midtjylland-2026-07-23");
assert.equal(besiktasResult && besiktasResult.status, "FINISHED", "Beşiktaş-Midtjylland result must be final");
assert.deepEqual(besiktasResult && besiktasResult.score && {
  home: besiktasResult.score.home,
  away: besiktasResult.score.away
}, { home: 1, away: 0 }, "Beşiktaş-Midtjylland official score must be 1-0");
const today = dateInTimeZone(new Date().toISOString(), "Europe/Istanbul");
const currentCuratedMatches = dedupeMatches(curatedMatches).filter((match) => dateInTimeZone(match.kickoffAtUtc, "Europe/Istanbul") === today);
const todayPage = fs.readFileSync(path.join(root, "bugunun-maclari.html"), "utf8");
assert.match(todayPage, /<title>Bugünün Futbol Maçları \| 25 Temmuz 2026 \| FutbolRadar<\/title>/, "Today's matches SEO title must target 25 July 2026");
assert.match(todayPage, /25 Temmuz 2026 Cumartesi günü oynanacak futbol ve hazırlık maçları/, "Today's matches SEO description must target 25 July 2026");
for (const filter of ["all", "turkiye", "premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1", "hazirlik-maclari"]) {
  assert.match(todayPage, new RegExp(`data-competition-filter="${filter}"`), `Today's matches filter is missing: ${filter}`);
}
assert.doesNotMatch(todayPage, /data-competition-filter="sampiyonlar-ligi"/, "Today's filter row must stay focused on the requested competition set");
assert.doesNotMatch(todayPage, /href="\.\/maclar\/"[^>]*>Bugünün Maçları/, "Today's page must not send the main full-list link back to /maclar/");
for (const match of currentCuratedMatches) {
  assert.match(todayPage, new RegExp(match.homeTeam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Today's verified fallback is missing ${match.homeTeam}`);
  assert.match(todayPage, new RegExp(match.awayTeam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Today's verified fallback is missing ${match.awayTeam}`);
}

const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
assert.match(css, /\.score-bottom-nav/, "Mobile bottom navigation styles are missing");
assert.match(css, /\.score-team-logo/, "Simple score cards must reserve stable team crest dimensions");
assert.match(css, /\.simple-score-card/, "Secondary score pages must use the simplified card surface");
assert.match(css, /\.score-link-groups/, "Compact discovery layout is missing");
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

const besiktasMatchPage = fs.readFileSync(path.join(root, "mac", "besiktas-fc-midtjylland-2026-07-23", "index.html"), "utf8");
assert.match(besiktasMatchPage, /Maç Sonucu: 1-0/, "Finished match SEO title must expose the verified score");
assert.match(besiktasMatchPage, /data-persistent-match-score>1-0</, "Finished match page must render the verified score");
assert.match(besiktasMatchPage, /data-static-match-events/, "Permanent match pages need a refreshable event section.");
assert.match(besiktasMatchPage, /data-static-match-statistics/, "Permanent match pages need a refreshable statistics section.");
assert.match(besiktasMatchPage, /data-static-match-lineups/, "Permanent match pages need a server-rendered lineup section.");

console.log("Score-first homepage, league pages, normalization and technical SEO tests passed.");
