import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { calculateMatchRadar, normalizeText } = require("../services/matchRadarService.js");
const { buildMatchContext } = require("../services/matchContextService.js");
const {
  generateProbableLineupForFixture,
  computeLineupStrength,
  computeBenchStrength,
  detectMissingKeyPlayers,
  compareProbableAndOfficialLineup
} = require("../services/lineupPredictionService.js");
const { buildComparison, generateMatchupAdvantages, buildMatchupSummary, generateKeyDuels } = require("../services/matchupService.js");
const { buildMatchPrediction, freezePreMatchPrediction, MODEL_VERSION } = require("../services/matchPredictionService.js");
const { getPlayers } = require("../services/playerService.js");
const { findCompetition, classifyFixtureCompetition } = require("../services/competitionCatalog.js");

const DATA_DIR = path.join(root, "data");
const MATCHES_PATH = path.join(DATA_DIR, "matches.json");
const TEAMS_PATH = path.join(DATA_DIR, "teams.json");
const PLAYERS_PATH = path.join(DATA_DIR, "players.json");
const SQUAD_STATUS_PATH = path.join(DATA_DIR, "squad-statuses.json");
const OUTPUT_PATH = path.join(DATA_DIR, "match-analyses.json");

const STATUS_MAP = {
  SCHEDULED: "scheduled",
  TIMED: "scheduled",
  NOT_STARTED: "scheduled",
  NS: "scheduled",
  LIVE: "live",
  IN_PLAY: "live",
  "1H": "live",
  "2H": "live",
  ET: "live",
  HT: "halftime",
  HALFTIME: "halftime",
  FINISHED: "finished",
  FT: "finished",
  AET: "finished",
  PEN: "finished",
  POSTPONED: "postponed",
  PST: "postponed",
  CANCELLED: "cancelled",
  CANC: "cancelled",
  SUSPENDED: "postponed"
};
const FINISHED_STATES = new Set(["finished"]);
const PRE_MATCH_STATES = new Set(["scheduled"]);
const STALE_HOURS_THRESHOLD = 30;

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Failed to parse ${path.relative(root, filePath)}: ${error.message}`);
    return fallback;
  }
}

function parseArgs(argv) {
  const args = { apply: false, dryRun: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.dryRun = true;
    else if (raw === "--upcoming") args.upcoming = true;
    else if (raw.startsWith("--date=")) args.date = raw.slice("--date=".length);
    else if (raw.startsWith("--days=")) args.days = Number(raw.slice("--days=".length));
    else if (raw.startsWith("--fixtureId=")) args.fixtureId = raw.slice("--fixtureId=".length);
  }
  if (!args.apply && !args.dryRun) args.dryRun = true;
  if (!args.date && !args.days && !args.fixtureId && !args.upcoming) args.date = "today";
  return args;
}

function todayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function dateOnly(isoValue) {
  return isoValue ? String(isoValue).slice(0, 10) : null;
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeStatus(rawStatus) {
  const key = String(rawStatus || "SCHEDULED").toUpperCase();
  return STATUS_MAP[key] || "scheduled";
}

function computeSeason(kickoffDate) {
  if (!kickoffDate || Number.isNaN(kickoffDate.getTime())) return null;
  const year = kickoffDate.getUTCFullYear();
  const month = kickoffDate.getUTCMonth() + 1;
  return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function resolveCompetition(match) {
  const found = findCompetition(match.competitionId || match.league);
  if (found) {
    return { id: found.id, name: found.name, country: found.country, season: computeSeason(new Date(match.kickoff)) };
  }
  if (match.competitionId === "hazirlik-maci" || normalizeText(match.league).includes("hazirlik")) {
    return { id: "hazirlik-maci", name: match.league || "Hazırlık Maçı", country: null, season: computeSeason(new Date(match.kickoff)) };
  }
  return { id: slug(match.competitionId || match.league || "diger"), name: match.league || "Bilinmeyen Turnuva", country: null, season: computeSeason(new Date(match.kickoff)) };
}

function resolveSourceStatus(match) {
  const dataStatus = normalizeText(match.dataStatus);
  if (dataStatus.includes("verified")) return "verified";
  if (match.source && match.source !== "mock") return "cached";
  if (match.homeTeam && match.awayTeam) return "cached";
  return "unavailable";
}

/**
 * Read-time canonical view of a matches.json record. data/matches.json stays
 * untouched (it carries hand-verified editorial content); this derives the
 * spec's normalized fixture shape without mutating the source file.
 */
function normalizeFixture(match) {
  const kickoffDate = new Date(match.kickoff);
  const hasValidKickoff = match.kickoff && !Number.isNaN(kickoffDate.getTime());
  const classification = classifyFixtureCompetition(match);

  return {
    id: match.id,
    fixtureId: match.id,
    providerId: match.providerId || null,
    slug: match.id || `${slug(match.homeTeam)}-${slug(match.awayTeam)}-${dateOnly(match.kickoff) || "tbd"}`,
    competition: resolveCompetition(match),
    competitionType: classification.competitionType,
    isOfficialCompetition: classification.isOfficialCompetition,
    includeInLeagueForm: classification.includeInLeagueForm,
    kickoff: hasValidKickoff ? kickoffDate.toISOString() : null,
    timezone: "Europe/Istanbul",
    status: normalizeStatus(match.status),
    homeTeam: { id: slug(match.homeTeam), providerId: null, name: match.homeTeam, slug: slug(match.homeTeam) },
    awayTeam: { id: slug(match.awayTeam), providerId: null, name: match.awayTeam, slug: slug(match.awayTeam) },
    score: match.score || { home: null, away: null, halftimeHome: null, halftimeAway: null },
    venue: { name: match.venue || null, city: match.city || null },
    sourceStatus: resolveSourceStatus(match),
    lastProviderSeenAt: match.fetchedAt || match.lastVerifiedAt || null,
    updatedAt: match.lastVerifiedAt || match.fetchedAt || new Date().toISOString(),
    hasValidKickoff
  };
}

function selectTargets(fixtures, args) {
  const withKickoff = fixtures.filter((fixture) => fixture.hasValidKickoff);
  const withoutKickoffCount = fixtures.length - withKickoff.length;
  if (withoutKickoffCount) {
    console.warn(`Skipping ${withoutKickoffCount} fixture(s) without a confirmed ISO kickoff (not eligible for match analysis).`);
  }

  if (args.fixtureId) {
    return withKickoff.filter((fixture) => fixture.id === args.fixtureId || fixture.providerId === args.fixtureId);
  }
  if (args.upcoming) {
    const now = Date.now();
    return withKickoff.filter((fixture) => fixture.status !== "finished" && fixture.status !== "cancelled" && new Date(fixture.kickoff).getTime() >= now - 3 * 60 * 60 * 1000);
  }
  if (args.days) {
    const start = args.date === "today" || !args.date ? todayInIstanbul() : args.date;
    const end = addDays(start, Math.max(1, args.days) - 1);
    return withKickoff.filter((fixture) => {
      const day = dateOnly(fixture.kickoff);
      return day && day >= start && day <= end;
    });
  }

  const targetDate = !args.date || args.date === "today" ? todayInIstanbul() : args.date;
  return withKickoff.filter((fixture) => dateOnly(fixture.kickoff) === targetDate);
}

function buildTeamBundle(teamName, fixture, players, teams, squadStatus, matchupTeamContext) {
  const teamPlayers = getPlayers(players).filter((player) => normalizeText(player.currentTeam || player.team) === normalizeText(teamName));
  const radarMatch = calculateMatchRadar({ homeTeam: fixture.homeTeam.name, awayTeam: fixture.awayTeam.name, providerId: fixture.providerId }, { teams, players, squadStatus });
  const side = normalizeText(teamName) === normalizeText(fixture.homeTeam.name) ? "home" : "away";
  const radar = radarMatch[side];

  const lineup = generateProbableLineupForFixture({ name: teamName, players: teamPlayers, side }, fixture, matchupTeamContext);
  const lineupStrength = computeLineupStrength(lineup);
  const benchStrength = computeBenchStrength(teamPlayers, lineup);
  const missingKeyPlayers = detectMissingKeyPlayers({ name: teamName }, lineup, teamPlayers);

  return { name: teamName, side, radar, lineup, lineupStrength, benchStrength, missingKeyPlayers, squadSize: teamPlayers.length };
}

function analysisStatusFor(prediction, homeLineup, awayLineup) {
  if (prediction.predictionStatus === "unavailable" && homeLineup.predictionStatus === "unavailable" && awayLineup.predictionStatus === "unavailable") {
    return "unavailable";
  }
  if (prediction.predictionStatus === "available" && prediction.dataConfidence >= 55 && homeLineup.predictionStatus !== "unavailable" && awayLineup.predictionStatus !== "unavailable") {
    return "complete";
  }
  return "partial";
}

function generateFreshAnalysis(fixture, matches, players, teams, squadStatus) {
  const context = buildMatchContext(fixture, fixture.homeTeam.name, fixture.awayTeam.name, matches);
  const home = buildTeamBundle(fixture.homeTeam.name, fixture, players, teams, squadStatus, context.home);
  const away = buildTeamBundle(fixture.awayTeam.name, fixture, players, teams, squadStatus, context.away);
  home.lineup.missingKeyPlayers = home.missingKeyPlayers;
  away.lineup.missingKeyPlayers = away.missingKeyPlayers;
  home.lineup.benchStrength = home.benchStrength;
  away.lineup.benchStrength = away.benchStrength;

  const matchup = buildComparison(home, away, context.home, context.away);
  const matchupAdvantages = generateMatchupAdvantages(matchup);
  const matchupSummary = buildMatchupSummary(matchup);
  const keyDuels = generateKeyDuels(home, away, context);
  let prediction = buildMatchPrediction(fixture, home, away, context.home, context.away, matchup);

  const warnings = [...prediction.warnings];
  if (home.squadSize === 0) warnings.push("home-squad-data-missing");
  if (away.squadSize === 0) warnings.push("away-squad-data-missing");

  const analysisStatus = analysisStatusFor(prediction, home.lineup, away.lineup);
  const isPreMatch = PRE_MATCH_STATES.has(fixture.status);
  if (!isPreMatch) {
    prediction = freezePreMatchPrediction(fixture, prediction);
  }

  return {
    fixtureId: fixture.id,
    slug: fixture.slug,
    competition: fixture.competition.name,
    competitionType: fixture.competitionType,
    isOfficialCompetition: fixture.isOfficialCompetition,
    includeInLeagueForm: fixture.includeInLeagueForm,
    kickoff: fixture.kickoff,
    status: fixture.status,
    generatedAt: new Date().toISOString(),
    preMatchFrozenAt: isPreMatch ? null : new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    homeContext: context.home,
    awayContext: context.away,
    probableLineups: { home: home.lineup, away: away.lineup },
    officialLineups: { home: null, away: null },
    matchup: { ...matchup, advantages: matchupAdvantages, summary: matchupSummary },
    keyDuels,
    prediction,
    dataConfidence: prediction.dataConfidence,
    analysisStatus,
    warnings
  };
}

function reconcileWithExisting(fixture, existing, fresh) {
  const isPreMatch = PRE_MATCH_STATES.has(fixture.status);

  if (isPreMatch || !existing) {
    return fresh;
  }

  if (existing.preMatchFrozenAt) {
    // Pre-match snapshot already frozen: only status/score-adjacent metadata may move.
    return {
      ...existing,
      status: fixture.status,
      updatedAt: new Date().toISOString()
    };
  }

  // First run observed after kickoff with a prior pre-match snapshot available: freeze it now.
  return {
    ...existing,
    status: fixture.status,
    preMatchFrozenAt: new Date().toISOString(),
    prediction: freezePreMatchPrediction(fixture, existing.prediction),
    updatedAt: new Date().toISOString()
  };
}

function validateRecord(record) {
  const errors = [];
  if (!record.fixtureId) errors.push("missing fixtureId");
  if (!record.slug) errors.push("missing slug");
  if (!record.kickoff || Number.isNaN(new Date(record.kickoff).getTime())) errors.push("invalid kickoff");
  const probabilities = record.prediction && record.prediction.probabilities;
  if (probabilities) {
    const sum = Number(probabilities.homeWin) + Number(probabilities.draw) + Number(probabilities.awayWin);
    if (sum !== 100) errors.push(`probabilities sum to ${sum}, expected 100`);
  }
  return errors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawMatches = readJson(MATCHES_PATH, []);
  const teams = readJson(TEAMS_PATH, []);
  const players = readJson(PLAYERS_PATH, []);
  const squadStatus = readJson(SQUAD_STATUS_PATH, { teams: [] });
  const existingAnalyses = readJson(OUTPUT_PATH, []);
  const existingById = new Map(existingAnalyses.map((item) => [item.fixtureId, item]));

  const seenIds = new Set();
  const fixtures = [];
  for (const match of rawMatches) {
    const key = match.providerId || match.id;
    if (seenIds.has(key)) {
      console.warn(`Duplicate fixture identity skipped: ${key}`);
      continue;
    }
    seenIds.add(key);
    fixtures.push(normalizeFixture(match));
  }

  const targets = selectTargets(fixtures, args);
  if (!targets.length) {
    console.log("No fixtures matched the given selection. Nothing to generate.");
    return;
  }

  const results = [];
  const errorsByFixture = new Map();

  for (const fixture of targets) {
    let record;
    try {
      const fresh = generateFreshAnalysis(fixture, rawMatches, players, teams, squadStatus);
      record = reconcileWithExisting(fixture, existingById.get(fixture.id), fresh);
    } catch (error) {
      console.error(`Failed to generate analysis for ${fixture.id}: ${error.message}`);
      const existing = existingById.get(fixture.id);
      if (existing) {
        record = { ...existing, analysisStatus: "stale", warnings: [...(existing.warnings || []), "regeneration-failed-kept-previous"] };
      }
      continue;
    }

    const validationErrors = validateRecord(record);
    if (validationErrors.length) {
      errorsByFixture.set(fixture.id, validationErrors);
      continue;
    }
    results.push(record);
  }

  if (errorsByFixture.size) {
    console.error("Validation failed for the following fixtures, no write performed for them:");
    for (const [fixtureId, errors] of errorsByFixture) {
      console.error(`  ${fixtureId}: ${errors.join(", ")}`);
    }
  }

  console.log(`Generated ${results.length} match analysis record(s) for ${targets.length} target fixture(s).`);
  for (const record of results) {
    console.log(`  - ${record.fixtureId} [${record.status}] analysisStatus=${record.analysisStatus} dataConfidence=${record.dataConfidence}`);
  }

  if (args.dryRun && !args.apply) {
    console.log("Dry run: data/match-analyses.json was not modified.");
    return;
  }

  if (!results.length) {
    console.log("Apply requested but nothing passed validation; canonical file left unchanged.");
    return;
  }

  const mergedById = new Map(existingAnalyses.map((item) => [item.fixtureId, item]));
  for (const record of results) {
    mergedById.set(record.fixtureId, record);
  }
  const merged = [...mergedById.values()].sort((left, right) => String(left.kickoff || "").localeCompare(String(right.kickoff || "")));

  const tempPath = `${OUTPUT_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(merged, null, 2)}\n`);
  fs.renameSync(tempPath, OUTPUT_PATH);
  console.log(`Wrote ${merged.length} total record(s) to ${path.relative(root, OUTPUT_PATH)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
