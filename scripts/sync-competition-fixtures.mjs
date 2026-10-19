#!/usr/bin/env node
/**
 * SEASON FIXTURES FOR THE STATS CENTRE (UEFA CL/EL and any league in
 * data/stats-leagues.json with `fixturesSource: "competition-fixtures"`).
 *
 * Per league+season, at most two API-Football requests:
 *   GET /fixtures/rounds?league={id}&season={season}   (round label list)
 *   GET /fixtures?league={id}&season={season}          (whole season, one response)
 *
 * Output: data/competition-fixtures.json, key `fixtures:{leagueId}:{season}`.
 * The raw provider round label (`league.round`, e.g. "League Stage - 3",
 * "Knockout Round Play-offs") is kept as `roundLabel`; mapping to site round
 * keys happens at render time from data/stats-leagues.json.
 *
 * QUOTA. This runs inside the existing hourly pipeline (no new cron). It
 * self-gates and normally makes ZERO requests:
 *   • refresh when the league has no cached entry,
 *   • or the entry is older than MAX_AGE (12 h),
 *   • or a cached fixture kicked off ≥ 135 min ago and is still not final
 *     (i.e. a result is due) and the entry is older than MIN_AGE (30 min).
 * /fixtures/rounds is only re-read once a day. A failed or empty response
 * NEVER replaces the previous entry.
 *
 * Usage: node scripts/sync-competition-fixtures.mjs [--apply] [--force]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const statsLeagues = require("../services/statsLeagues.js");

const root = process.cwd();
const OUTPUT_PATH = path.join(root, statsLeagues.FIXTURES_RELATIVE_PATH);
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MIN_AGE_MS = 30 * 60 * 1000;
const ROUNDS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RESULT_DUE_MS = 135 * 60 * 1000;
const FINAL_STATES = new Set(["FINISHED", "AWARDED", "POSTPONED", "CANCELLED", "ABANDONED"]);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function refreshReason(entry, now = new Date(), options = {}) {
  if (options.force) return "forced";
  if (!entry || !Array.isArray(entry.fixtures) || !entry.fixtures.length) return "missing";
  const age = now.getTime() - Date.parse(entry.fetchedAt || 0);
  if (!Number.isFinite(age) || age >= MAX_AGE_MS) return "stale";
  if (age < MIN_AGE_MS) return null;
  const due = entry.fixtures.some((fixture) => {
    const kickoff = Date.parse(fixture.kickoff || "");
    return Number.isFinite(kickoff) && kickoff + RESULT_DUE_MS <= now.getTime() && kickoff > now.getTime() - MAX_AGE_MS * 4 && !FINAL_STATES.has(fixture.status);
  });
  return due ? "result-due" : null;
}

/** Only the fields the stats pages read; keeps the committed file small. */
export function compactProviderFixture(item, normalizeFixture) {
  const normalized = normalizeFixture(item);
  return {
    providerId: normalized.providerId,
    providerLeagueId: normalized.providerLeagueId,
    roundLabel: (item.league && item.league.round) || null,
    kickoff: normalized.kickoff,
    status: normalized.status,
    providerStatus: normalized.providerStatus,
    homeTeam: normalized.homeTeam,
    awayTeam: normalized.awayTeam,
    homeTeamId: normalized.homeTeamId ? String(normalized.homeTeamId) : null,
    awayTeamId: normalized.awayTeamId ? String(normalized.awayTeamId) : null,
    homeTeamLogo: normalized.homeTeamLogo || null,
    awayTeamLogo: normalized.awayTeamLogo || null,
    score: { home: normalized.score.home, away: normalized.score.away }
  };
}

export async function syncCompetitionFixtures(options = {}) {
  const provider = options.provider;
  const now = options.now || new Date();
  const previous = options.previous || readJson(OUTPUT_PATH, { cache: {} });
  const cache = { ...(previous.cache || {}) };
  const diagnostics = { fetched: [], skipped: [], failed: [], unknownRounds: [], requests: 0 };
  const leagues = (options.leagues || statsLeagues.loadStatsLeagues({ root })).filter((league) => league.fixturesSource === "competition-fixtures");

  for (const league of leagues) {
    const season = statsLeagues.resolveSeason(league, now);
    const key = statsLeagues.fixturesKey(league, season);
    const entry = cache[key];
    const reason = refreshReason(entry, now, options);
    if (!reason) {
      diagnostics.skipped.push({ league: league.slug, key, reason: "fresh" });
      continue;
    }
    try {
      let rounds = entry && Array.isArray(entry.rounds) ? entry.rounds : [];
      let roundsFetchedAt = entry && entry.roundsFetchedAt;
      if (!rounds.length || !roundsFetchedAt || now.getTime() - Date.parse(roundsFetchedAt) >= ROUNDS_MAX_AGE_MS || options.force) {
        diagnostics.requests += 1;
        const payload = await provider.providerFetch("/fixtures/rounds", { league: league.apiId, season });
        const fetched = Array.isArray(payload && payload.response) ? payload.response.map(String) : [];
        if (fetched.length) {
          rounds = fetched;
          roundsFetchedAt = now.toISOString();
        }
      }
      diagnostics.requests += 1;
      const payload = await provider.providerFetch("/fixtures", { league: league.apiId, season, timezone: "Europe/Istanbul" });
      const items = Array.isArray(payload && payload.response) ? payload.response : [];
      const fixtures = items
        .filter((item) => item && item.league && String(item.league.id) === String(league.apiId))
        .map((item) => compactProviderFixture(item, provider.normalizeFixture))
        .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)) || String(left.providerId).localeCompare(String(right.providerId)));
      if (!fixtures.length) {
        diagnostics.skipped.push({ league: league.slug, key, reason: "empty-response" });
        continue;
      }
      const unknown = [...new Set([...rounds, ...fixtures.map((fixture) => fixture.roundLabel)])]
        .filter(Boolean)
        .filter((label) => !statsLeagues.mapRound(label, league).known);
      if (unknown.length) diagnostics.unknownRounds.push({ league: league.slug, labels: unknown });
      cache[key] = {
        league: league.slug,
        leagueId: String(league.apiId),
        season,
        fetchedAt: now.toISOString(),
        roundsFetchedAt: roundsFetchedAt || null,
        refreshReason: reason,
        rounds,
        unknownRounds: unknown,
        fixtures
      };
      diagnostics.fetched.push({ league: league.slug, key, fixtures: fixtures.length, reason });
    } catch (error) {
      diagnostics.failed.push({ league: league.slug, key, error: error.message });
    }
  }

  return {
    generatedAt: now.toISOString(),
    source: "api-football:/fixtures/rounds,/fixtures",
    keyFormat: "fixtures:{leagueId}:{season}",
    cache,
    diagnostics
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const provider = require("../services/providers/apiFootballProvider.js");
  if (!provider.hasConfig()) {
    throw new Error("APIFOOTBALL_API_KEY is not configured; competition fixtures synchronization cannot run.");
  }
  const result = await syncCompetitionFixtures({ provider, force });
  const changed = result.diagnostics.fetched.length > 0;
  if (apply && changed) atomicWrite(OUTPUT_PATH, result);
  const d = result.diagnostics;
  console.log(`[competition-fixtures] fetched=${d.fetched.length} skipped=${d.skipped.length} failed=${d.failed.length} requests=${d.requests}`);
  for (const item of d.unknownRounds) console.warn(`[competition-fixtures] ${item.league}: unmapped round labels ${JSON.stringify(item.labels)} — add them to data/stats-leagues.json`);
  for (const failure of d.failed) console.warn(`[competition-fixtures] ${failure.key}: ${failure.error}`);
  if (!apply) console.log("[competition-fixtures] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify({ source: "api-football", checked: d.fetched.length + d.skipped.length, updated: apply ? d.fetched.length : 0, errors: d.failed.map((item) => `${item.key}: ${item.error}`) })}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[competition-fixtures] ${error.message}`);
    process.exitCode = 1;
  });
}
