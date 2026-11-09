#!/usr/bin/env node
/**
 * Premier Lig (39) ve La Liga (140) için API-Football dosyası.
 *
 * İstekler: lig başına 1 sezon fikstürü + 1 takım listesi, sonra takım
 * başına 1 kadro. Günlük kotanın canlı skor payı (25) ve koşu tavanı (45)
 * aşılmaz. Dakika penceresi dolunca beklenir. TheSportsDB yok.
 *
 * Tamamlanmış dilimler yeniden istenmez. `--refresh` hepsini yeniler.
 * Anahtar yoksa dosyaya dokunulmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { INDEX_LEAGUES, MIN_SQUAD, DOSSIER_FILE } from "./lib/europeanClubPages.mjs";
import { importanceIndex } from "./lib/standingsTeamLinks.mjs";
import { RICH_TEAM_PAGES } from "./lib/richTeamPages.mjs";

const require = createRequire(import.meta.url);
const {
  hasConfig,
  getSeasonFixtures,
  getSquad,
  providerFetch,
  getProviderRateLimit,
  providerRequestStats,
  ProviderError
} = require("../services/providers/apiFootballProvider.js");
const { RESERVE_FOR_LIVE } = require("../services/requestBudget.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_CAP = 45;
const refresh = process.argv.includes("--refresh");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let paced = 0;

function canSpend() {
  const rate = getProviderRateLimit();
  if (rate.remaining !== null && rate.remaining <= RESERVE_FOR_LIVE) return false;
  if (providerRequestStats().total >= RUN_CAP) return false;
  return true;
}

async function pace() {
  if (paced > 0) await sleep(7000);
  paced += 1;
  const rate = getProviderRateLimit();
  if (rate.minuteRemaining !== null && rate.minuteRemaining <= 1) {
    console.log("[european-club-dossier] dakika penceresi dolu, 65 sn bekleniyor.");
    await sleep(65000);
  }
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slimFixture(match) {
  const kickoff = match.kickoff || "";
  const time = (String(kickoff).match(/T(\d{2}:\d{2})/) || [])[1] || "";
  const homeScore = finite(match.score && match.score.home);
  const awayScore = finite(match.score && match.score.away);
  return {
    providerId: match.providerId ? String(match.providerId) : "",
    kickoff,
    time,
    status: match.status || "UNKNOWN",
    homeTeam: match.homeTeam || "",
    awayTeam: match.awayTeam || "",
    homeTeamId: match.homeTeamId ? String(match.homeTeamId) : "",
    awayTeamId: match.awayTeamId ? String(match.awayTeamId) : "",
    homeScore,
    awayScore,
    venue: match.venue || "",
    round: finite(match.round)
  };
}

function slimTeam(item) {
  const team = item.team || {};
  const venue = item.venue || {};
  const capacity = finite(venue.capacity);
  const founded = finite(team.founded);
  return {
    name: team.name || "",
    country: team.country || "",
    founded: founded !== null && founded >= 1800 ? founded : null,
    logo: team.logo || "",
    venue: {
      name: venue.name || "",
      city: venue.city || "",
      capacity: capacity !== null && capacity > 0 ? capacity : null
    },
    infoSource: "teams",
    squadFetchedAt: "",
    players: []
  };
}

function slimPlayer(player) {
  const age = finite(player.age);
  const number = finite(player.shirtNumber);
  return {
    id: String(player.providerId || player.id || ""),
    name: player.name || "",
    number,
    position: player.position || "",
    age: age !== null && age > 0 ? age : null
  };
}

function loadPrevious() {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, DOSSIER_FILE), "utf8"));
  } catch {
    return { source: "api-football", season: "", syncedAt: "", leagues: {} };
  }
}

function standingsTeams() {
  const standings = JSON.parse(fs.readFileSync(path.join(root, "data", "league-standings.json"), "utf8"));
  const byLeague = {};
  for (const leagueId of Object.keys(INDEX_LEAGUES)) {
    const table = (standings[leagueId] && standings[leagueId].table) || [];
    byLeague[leagueId] = {
      season: String((standings[leagueId] && standings[leagueId].season) || ""),
      teams: table
        .map((row) => ({ id: String(row.providerId || row.id || ""), name: row.name || row.team || "" }))
        .filter((row) => row.id && !RICH_TEAM_PAGES[row.id])
    };
  }
  return byLeague;
}

async function main() {
  if (!hasConfig()) {
    console.log("[european-club-dossier] APIFOOTBALL_API_KEY yok, dosya değişmedi.");
    return;
  }
  const previous = loadPrevious();
  const wanted = standingsTeams();
  const season = wanted["premier-league"].season || wanted["la-liga"].season;
  const dossier = {
    source: "api-football",
    season,
    syncedAt: new Date().toISOString(),
    leagues: {}
  };
  let stopped = "";

  for (const [leagueId, meta] of Object.entries(INDEX_LEAGUES)) {
    const prior = (previous.leagues || {})[leagueId] || {};
    const block = {
      providerLeagueId: meta.providerLeagueId,
      fixturesFetchedAt: prior.fixturesFetchedAt || "",
      teamsFetchedAt: prior.teamsFetchedAt || "",
      fixtures: Array.isArray(prior.fixtures) ? prior.fixtures : [],
      clubs: { ...(prior.clubs || {}) }
    };
    for (const id of Object.keys(block.clubs)) {
      if (RICH_TEAM_PAGES[id]) delete block.clubs[id];
    }
    if (stopped) {
      dossier.leagues[leagueId] = block;
      continue;
    }
    const needFixtures = refresh || block.fixtures.length < 20;
    const needTeams = refresh || Object.keys(block.clubs).length < wanted[leagueId].teams.length;
    try {
      if (needFixtures) {
        if (!canSpend()) { stopped = stopped || "quota"; }
        else {
          await pace();
          const fixtures = await getSeasonFixtures({ league: meta.providerLeagueId, season });
          block.fixtures = fixtures.map(slimFixture);
          block.fixturesFetchedAt = fixtures[0] && fixtures[0].fetchedAt ? fixtures[0].fetchedAt : new Date().toISOString();
        }
      }
      if (needTeams && !stopped) {
        if (!canSpend()) { stopped = stopped || "quota"; }
        else {
          await pace();
          const payload = await providerFetch("/teams", { league: meta.providerLeagueId, season });
          const items = Array.isArray(payload.response) ? payload.response : [];
          const fetchedAt = new Date().toISOString();
          for (const item of items) {
            const id = String((item.team && item.team.id) || "");
            if (!id || RICH_TEAM_PAGES[id]) continue;
            const previousClub = block.clubs[id] || {};
            block.clubs[id] = {
              ...slimTeam(item),
              squadFetchedAt: previousClub.squadFetchedAt || "",
              players: Array.isArray(previousClub.players) ? previousClub.players : []
            };
          }
          block.teamsFetchedAt = fetchedAt;
        }
      }
    } catch (error) {
      stopped = stopped || (error instanceof ProviderError ? error.code : "error");
      console.log(`[european-club-dossier] ${leagueId} durdu: ${error.code || error.message}`);
    }
    dossier.leagues[leagueId] = block;
  }

  const queue = [];
  for (const [leagueId, info] of Object.entries(wanted)) {
    for (const team of info.teams) queue.push({ leagueId, ...team });
  }
  queue.sort((a, b) => importanceIndex(a.name) - importanceIndex(b.name) || a.name.localeCompare(b.name));

  let squads = 0;
  for (const team of queue) {
    if (stopped) break;
    const block = dossier.leagues[team.leagueId];
    const club = block.clubs[team.id] || { name: team.name, country: "", founded: null, logo: "", venue: { name: "", city: "", capacity: null }, squadFetchedAt: "", players: [] };
    block.clubs[team.id] = club;
    if (!refresh && Array.isArray(club.players) && club.players.filter((player) => player && player.name).length >= MIN_SQUAD) continue;
    if (!canSpend()) { stopped = stopped || "quota"; break; }
    try {
      await pace();
      const players = await getSquad({ teamId: team.id });
      club.players = players.map(slimPlayer).filter((player) => player.name);
      club.squadFetchedAt = players[0] && players[0].fetchedAt ? players[0].fetchedAt : new Date().toISOString();
      if (!club.name) club.name = team.name;
      squads += 1;
    } catch (error) {
      stopped = stopped || (error instanceof ProviderError ? error.code : "error");
      console.log(`[european-club-dossier] kadro ${team.id} durdu: ${error.code || error.message}`);
      break;
    }
  }

  const file = path.join(root, DOSSIER_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(dossier, null, 2)}\n`);
  const rate = getProviderRateLimit();
  console.log(`[european-club-dossier] istek ${providerRequestStats().total}, kalan ${rate.remaining === null ? "bilinmiyor" : rate.remaining}, kadro çekimi ${squads}, duruş ${stopped || "yok"}`);
}

main().catch((error) => {
  console.error(`[european-club-dossier] ${error.code || ""} ${error.message || error}`.trim());
  process.exitCode = 1;
});
