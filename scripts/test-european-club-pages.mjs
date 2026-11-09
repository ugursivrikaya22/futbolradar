#!/usr/bin/env node
/**
 * Premier Lig / La Liga kulüp sayfası: eşik, aynı sayılar, İngilizce yüzey,
 * noindex olan sayfanın haritaya girmemesi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { scanHtml } from "./lib/turkish-detector.mjs";
import { RICH_TEAM_PAGES } from "./lib/richTeamPages.mjs";
import {
  INDEX_LEAGUES,
  MIN_SQUAD,
  assessHub,
  assessSquad,
  pageCopy,
  renderHub,
  renderSquad,
  sitemapEntry
} from "./lib/europeanClubPages.mjs";
import { clubBundle } from "./generate-european-club-pages.mjs";

const root = process.cwd();
const standings = JSON.parse(fs.readFileSync(path.join(root, "data/league-standings.json"), "utf8"));

function standingFor(row, leagueId) {
  return {
    leagueId,
    providerLeagueId: INDEX_LEAGUES[leagueId].providerLeagueId,
    season: "2026",
    updatedAt: "2026-11-06T02:20:44.818Z",
    rank: row.rank,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalDifference,
    points: row.points,
    form: row.form
  };
}

const sampleRow = standings["premier-league"].table.find((row) => row.providerId === "42");
const standing = standingFor(sampleRow, "premier-league");
const record = {
  id: "42",
  slug: "arsenal",
  name: "Arsenal",
  trHref: "takimlar/arsenal",
  enHref: "en/club/arsenal",
  logo: sampleRow.logo,
  competitions: [standing, {
    leagueId: "sampiyonlar-ligi",
    providerLeagueId: "2",
    season: "2026",
    updatedAt: "2026-11-06T02:20:44.818Z",
    rank: 4,
    played: 3,
    points: 6,
    form: ["W", "D"]
  }]
};
const players = Array.from({ length: MIN_SQUAD }, (_, index) => ({
  id: String(index + 1),
  name: `Player ${index + 1}`,
  number: index + 1,
  position: ["Goalkeeper", "Defender", "Midfielder", "Attacker"][index % 4],
  age: 20 + (index % 10)
}));
const club = {
  teamId: "42",
  country: "England",
  founded: 1886,
  teamsFetchedAt: "2026-11-09T10:00:00.000Z",
  squadFetchedAt: "2026-11-09T10:00:00.000Z",
  fixturesFetchedAt: "2026-11-09T10:00:00.000Z",
  venue: { name: "Emirates Stadium", city: "London", capacity: 60704 },
  players
};
const matches = [
  { providerId: "1", kickoff: "2026-10-01T20:00:00+03:00", time: "20:00", status: "FINISHED", homeTeam: "Arsenal", awayTeam: "Chelsea", homeTeamId: "42", awayTeamId: "49", homeScore: 2, awayScore: 1, venue: "Emirates Stadium", round: 6 },
  { providerId: "2", kickoff: "2026-10-08T20:00:00+03:00", time: "20:00", status: "FINISHED", homeTeam: "Everton", awayTeam: "Arsenal", homeTeamId: "45", awayTeamId: "42", homeScore: 0, awayScore: 1, venue: "", round: 7 },
  { providerId: "3", kickoff: "2026-10-15T20:00:00+03:00", time: "20:00", status: "FINISHED", homeTeam: "Arsenal", awayTeam: "Fulham", homeTeamId: "42", awayTeamId: "36", homeScore: 3, awayScore: 0, venue: "Emirates Stadium", round: 8 },
  { providerId: "4", kickoff: "2026-11-20T20:00:00+03:00", time: "20:00", status: "SCHEDULED", homeTeam: "Arsenal", awayTeam: "Tottenham", homeTeamId: "42", awayTeamId: "47", homeScore: null, awayScore: null, venue: "Emirates Stadium", round: 12 },
  { providerId: "5", kickoff: "2026-10-02T20:00:00+03:00", time: "20:00", status: "POSTPONED", homeTeam: "Arsenal", awayTeam: "Leeds", homeTeamId: "42", awayTeamId: "63", homeScore: null, awayScore: null, round: 5 }
];

const full = assessHub({ standing, club, matches, teamId: "42" });
assert.equal(full.indexable, true, full.reasons.join(","));
assert.equal(full.results.length, 3);
assert.equal(full.fixtures.length, 1);
assert.equal(full.results.some((match) => match.status === "POSTPONED"), false);

const noSquad = assessHub({ standing, club: { ...club, players: [] }, matches, teamId: "42" });
assert.equal(noSquad.indexable, true, noSquad.reasons.join(","));
const noVenue = assessHub({ standing, club: { players }, matches, teamId: "42" });
assert.equal(noVenue.indexable, false);
assert.ok(noVenue.reasons.includes("club"));
const noResult = assessHub({ standing, club, matches: matches.slice(0, 2), teamId: "42" });
assert.equal(noResult.indexable, false);
assert.ok(noResult.reasons.includes("results"));
assert.equal(assessSquad(club).indexable, true);
assert.equal(assessSquad({ players: players.slice(0, 3) }).indexable, false);

for (const leagueId of Object.keys(INDEX_LEAGUES)) {
  for (const row of standings[leagueId].table) {
    if (RICH_TEAM_PAGES[String(row.providerId)]) continue;
    const rowStanding = standingFor(row, leagueId);
    for (const locale of ["tr", "en"]) {
      for (const kind of ["hub", "squad"]) {
        for (const hasSquad of [false, true]) {
          const copy = pageCopy({ name: row.name }, rowStanding, locale, kind, { hasSquad });
          assert.ok(copy.title.length <= 60, copy.title);
          assert.ok(copy.description.length <= 155, `${copy.description} (${copy.description.length})`);
        }
      }
    }
  }
}

const tr = renderHub({ record, standing, club, matches, locale: "tr", robots: ROBOTS_INDEX, header: "", footer: "" });
const en = renderHub({ record, standing, club, matches, locale: "en", robots: ROBOTS_INDEX, header: "", footer: "" });
assert.match(tr.html, new RegExp(ROBOTS_INDEX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(tr.html, /hreflang="tr-TR"/);
assert.match(tr.html, /hreflang="en"/);
assert.match(tr.html, /hreflang="x-default" href="https:\/\/www\.futbolradar\.com\/takimlar\/arsenal"/);
assert.match(en.html, /hreflang="x-default" href="https:\/\/www\.futbolradar\.com\/takimlar\/arsenal"/);
assert.equal(en.canonical, "https://www.futbolradar.com/en/club/arsenal");
for (const token of ["2-1", "0-1", "3-0", ">24<", ">9<", "Emirates Stadium", "1886", "60704", "Player 1"]) {
  assert.ok(tr.html.includes(token), `TR eksik ${token}`);
  assert.ok(en.html.includes(token), `EN eksik ${token}`);
}
assert.equal(tr.html.includes("TheSportsDB"), false);
assert.equal(en.html.includes("TheSportsDB"), false);
assert.equal(en.html.includes("POSTPONED") || en.html.includes("Leeds"), false);
assert.equal(scanHtml(en.html, { limit: 5 }).length, 0, JSON.stringify(scanHtml(en.html, { limit: 5 })));
assert.ok(en.html.includes("API-Football"));
assert.ok(tr.html.includes("Şampiyonlar Ligi") || tr.html.includes("Champions") || tr.html.includes(">4<") || tr.html.includes("Rank 4") || tr.html.includes("Sıra 4"));

const squadEn = renderSquad({ record, standing, club, locale: "en", robots: ROBOTS_INDEX, header: "", footer: "" });
assert.equal(squadEn.canonical, "https://www.futbolradar.com/en/club/arsenal/squad");
assert.equal(scanHtml(squadEn.html, { limit: 5 }).length, 0, JSON.stringify(scanHtml(squadEn.html, { limit: 5 })));
const squadTr = renderSquad({ record, standing, club, locale: "tr", robots: ROBOTS_NOINDEX_FOLLOW, header: "", footer: "" });
assert.match(squadTr.html, /noindex,follow/);

const entry = sitemapEntry({ loc: en.canonical, lastmod: "2026-11-09", trUrl: tr.canonical, enUrl: en.canonical });
assert.match(entry, /hreflang="x-default"/);
assert.match(entry, /<lastmod>2026-11-09<\/lastmod>/);

const dossier = {
  leagues: {
    "premier-league": {
      teamsFetchedAt: club.teamsFetchedAt,
      fixturesFetchedAt: club.fixturesFetchedAt,
      fixtures: matches,
      clubs: { "42": club, "40": club }
    }
  }
};
assert.equal(clubBundle({ ...record, id: "40" }, dossier), null);
const built = clubBundle(record, dossier);
assert.equal(built.hub.indexable, true);

const liverpool = fs.readFileSync(path.join(root, "takimlar/liverpool.html"), "utf8");
assert.ok(liverpool.includes("Anfield") || liverpool.includes("Kupa"));
const inter = fs.readFileSync(path.join(root, "takimlar/inter.html"), "utf8");
assert.match(inter, /noindex,follow/);
assert.equal(inter.includes('data-european-club='), false);

const arsenalFile = path.join(root, "takimlar/arsenal.html");
const arsenalHtml = fs.readFileSync(arsenalFile, "utf8");
if (arsenalHtml.includes('data-european-club="42"')) {
  assert.match(arsenalHtml, new RegExp(ROBOTS_INDEX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(arsenalHtml, /hreflang="x-default"/);
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.ok(sitemap.includes("https://www.futbolradar.com/takimlar/arsenal<"));
  assert.ok(sitemap.includes("https://www.futbolradar.com/en/club/arsenal<"));
  assert.equal(sitemap.includes("https://www.futbolradar.com/takimlar/inter<"), false);
  const enFile = fs.readFileSync(path.join(root, "en/club/arsenal.html"), "utf8");
  assert.equal(scanHtml(enFile, { limit: 4 }).length, 0, JSON.stringify(scanHtml(enFile, { limit: 4 })));
  assert.ok(enFile.includes(">24<") && arsenalHtml.includes(">24<"));
  if (arsenalHtml.includes('id="kadro"')) assert.ok(fs.existsSync(path.join(root, "takimlar/arsenal/kadro.html")));
}

console.log("european club pages OK");
