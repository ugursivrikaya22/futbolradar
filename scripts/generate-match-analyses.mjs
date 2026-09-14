import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { calculateMatchRadar, normalizeText } = require("../services/matchRadarService.js");
const { buildMatchContext, computeHeadToHead } = require("../services/matchContextService.js");
const { computeTeamMomentum, hasMomentumInputs } = require("../services/momentumService.js");
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
const { computeAnalysisCoverage, analysisStatusFromCoverage } = require("../services/analysisCoverageService.js");
const { isSameFixture } = require("../services/fixtureCalendar.js");

const DATA_DIR = path.join(root, "data");
const MATCHES_PATH = path.join(DATA_DIR, "matches.json");
const CALENDAR_PATH = path.join(DATA_DIR, "fixture-calendar.json");
const ARCHIVE_PATH = path.join(DATA_DIR, "historical-match-archive.json");
const TEAMS_PATH = path.join(DATA_DIR, "teams.json");
const PLAYERS_PATH = path.join(DATA_DIR, "players.json");
const INTL_TEAMS_PATH = path.join(DATA_DIR, "international-teams.json");
const INTL_SQUADS_PATH = path.join(DATA_DIR, "international-squads.json");
const SQUAD_STATUS_PATH = path.join(DATA_DIR, "squad-statuses.json");
const OUTPUT_PATH = path.join(DATA_DIR, "match-analyses.json");
// Doğrulayıcı (validate-match-analyses checkPublicSync) kök dosya ile public
// kopyanın bayt bayt aynı olmasını İSTER ve zamanlanmış akışta derlemeden
// ÖNCE koşar — kopyayı derleme adımına bırakmak doğrulamayı düşürür.
const PUBLIC_OUTPUT_PATH = path.join(root, "public", "data", "match-analyses.json");

/**
 * Takvimden analiz hedefi olarak alınan yarışmalar. Bilinçli olarak dar:
 * mac/ altındaki üretilmiş analiz sayfaları yalnızca Süper Lig fikstürü
 * için var; diğer liglerin analizini üretmek kimsenin okumayacağı ~4MB
 * kayıt biriktirirdi. matches.json'daki elle doğrulanmış kayıtlar (Avrupa
 * kupaları dahil) bu süzgeçten bağımsız, eskisi gibi hedeflenir.
 */
const CALENDAR_TARGET_COMPETITIONS = new Set(["super-lig"]);

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
    // YALNIZCA API-Football kimliği taşınır: providerIds.apiFootball, ya da
    // kaydın kendisi api-football kaynaklıysa üst düzey providerId. Düz
    // providerId'ye körlemesine düşülMEZ — TheSportsDB'nin SAYISAL etkinlik
    // kimliği buradan sızıp resmî 11 ve canlı istatistik isteklerini yanlış
    // maça yönlendiriyordu. Kimlik yoksa null kalır; sync-fixture-predictions
    // sezon fikstüründen çözünce sonraki üretimde dolar.
    providerId: (match.providerIds && match.providerIds.apiFootball) ||
      (match.source === "api-football" ? match.providerId : null) || null,
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

/**
 * data/international-teams.json + data/international-squads.json'ı
 * (scripts/sync-international-opponents.mjs'in ürettiği, Türk kulüplerinin
 * UEFA kupası rakiplerine ait dar kapsamlı veri) çalışma kümesine EKLER —
 * data/teams.json / data/players.json diske hiç YAZILMAZ. Böylece bu iki
 * dosyayı "18 Süper Lig takımı" varsayan onlarca başka sayfa üretici
 * (takımlar, puan durumu, karşılaştırmalar…) hiç etkilenmez; yalnızca bu
 * betiğin kendi bellekteki `teams`/`players` kümesi genişler.
 *
 * Rakip takımların lig sırası ve momentumu YOKTUR — buildLeagueSnapshot ve
 * buildMomentumSnapshot zaten bu satırlarda `rank`/`form` alanı bulamayıp
 * dürüstçe "unavailable" döner; burada ayrıca bir şey uydurulmaz.
 */
function mergeInternationalData(teams, players) {
  const intlTeams = readJson(INTL_TEAMS_PATH, []);
  const intlSquads = readJson(INTL_SQUADS_PATH, []);

  const mergedTeams = [...teams, ...intlTeams];

  const intlPlayers = intlSquads.flatMap((snapshot) =>
    (snapshot.players || []).map((player) => ({
      id: player.providerId ? `intl-${player.providerId}` : undefined,
      providerId: player.providerId || null,
      name: player.name,
      number: player.number ?? null,
      position: player.position || null,
      age: player.age ?? null,
      photo: player.photo || null,
      currentTeam: snapshot.teamName,
      team: snapshot.teamName
    }))
  );

  return { teams: mergedTeams, players: [...players, ...intlPlayers] };
}

function findTeamRecord(teamName, teams) {
  const key = normalizeText(teamName);
  if (!key) return null;
  return (Array.isArray(teams) ? teams : []).find((team) => normalizeText(team.name || team.team) === key) || null;
}

/**
 * Lig sıralaması: teams.json'daki senkronlanmış satırdan AYNEN okunur,
 * yeniden hesaplanmaz — bu dosya generate-team-standings-pages.mjs'in de
 * kaynağı, yani site genelinde tek bir "doğru" sıralama vardır. Takım
 * bulunamazsa (henüz senkronlanmamış / şimdilik Süper Lig dışı) alanlar
 * null kalır; sıra uydurulmaz.
 */
function buildLeagueSnapshot(teamName, teams) {
  const record = findTeamRecord(teamName, teams);
  if (!record || !Number.isFinite(Number(record.rank))) {
    return { rank: null, points: null, played: null, goalDifference: null, season: null, status: "unavailable" };
  }
  return {
    rank: record.rank,
    points: Number.isFinite(Number(record.points)) ? record.points : null,
    played: Number.isFinite(Number(record.played)) ? record.played : null,
    goalDifference: Number.isFinite(Number(record.average)) ? record.average : null,
    season: record.standingsSeason || null,
    status: record.standingsStatus || "available"
  };
}

/**
 * Momentum: /api/momentum ile AYNI hesap (computeTeamMomentum), aynı
 * girdilerle (teams hem takım hem "standings" argümanı olarak) çağrılır —
 * maç analizindeki momentum sayısı, kullanıcının momentum sayfasında
 * gördüğüyle HER ZAMAN tutarlı olmalı. Girdi yoksa (hasMomentumInputs
 * false döner) hesap uydurulmaz; alan "unavailable" durumuyla null kalır.
 */
function buildMomentumSnapshot(teamName, teams, matchPool) {
  const record = findTeamRecord(teamName, teams) || { name: teamName };
  if (!hasMomentumInputs(record)) {
    return { score: null, trend: null, goalSignal: null, risk: null, status: "unavailable" };
  }
  const computed = computeTeamMomentum(record, matchPool, teams);
  return {
    score: computed.momentum,
    trend: computed.trend,
    goalSignal: computed.goalSignal,
    risk: computed.risk,
    status: "available"
  };
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

  return { name: teamName, side, radar, lineup, lineupStrength, benchStrength, missingKeyPlayers, squadPlayers: teamPlayers, squadSize: teamPlayers.length };
}

function generateFreshAnalysis(fixture, matches, players, teams, squadStatus) {
  const context = buildMatchContext(fixture, fixture.homeTeam.name, fixture.awayTeam.name, matches);
  context.home = {
    ...context.home,
    leaguePosition: buildLeagueSnapshot(fixture.homeTeam.name, teams),
    momentum: buildMomentumSnapshot(fixture.homeTeam.name, teams, matches)
  };
  context.away = {
    ...context.away,
    leaguePosition: buildLeagueSnapshot(fixture.awayTeam.name, teams),
    momentum: buildMomentumSnapshot(fixture.awayTeam.name, teams, matches)
  };
  const headToHead = computeHeadToHead(fixture.homeTeam.name, fixture.awayTeam.name, fixture.kickoff, matches);
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

  const coverage = computeAnalysisCoverage({
    home,
    away,
    homeContext: context.home,
    awayContext: context.away,
    homeSquad: home.squadPlayers,
    awaySquad: away.squadPlayers,
    officialLineupStatus: "unavailable"
  });
  const analysisStatus = analysisStatusFromCoverage(coverage);
  const isPreMatch = PRE_MATCH_STATES.has(fixture.status);
  if (!isPreMatch) {
    prediction = freezePreMatchPrediction(fixture, prediction);
  }

  return {
    fixtureId: fixture.id,
    // Sağlayıcının sayısal fikstür kimliği: resmî 11 tazelemesi ve canlı
    // istatistik ucu (/api/match-detail) bu kimlikle çalışır. Yoksa null —
    // uydurulmaz, o kayıtta resmî 11 "pending"de kalır.
    providerId: /^\d+$/.test(String(fixture.providerId || "")) ? String(fixture.providerId) : null,
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
    headToHead,
    probableLineups: { home: home.lineup, away: away.lineup },
    officialLineups: { home: null, away: null },
    officialLineupStatus: "unavailable",
    matchup: { ...matchup, advantages: matchupAdvantages, summary: matchupSummary },
    keyDuels,
    prediction,
    coverage,
    dataConfidence: prediction.dataConfidence,
    analysisStatus,
    warnings
  };
}

function reconcileWithExisting(fixture, existing, fresh) {
  const isPreMatch = PRE_MATCH_STATES.has(fixture.status);

  if (isPreMatch || !existing) {
    if (isPreMatch && existing && existing.officialLineupStatus === "available") {
      // An official lineup can be fetched by the separate lineup-refresh job
      // while a fixture is still "scheduled" — a routine regenerate here must
      // not erase it, since that job never re-runs once it has succeeded.
      return {
        ...fresh,
        officialLineups: existing.officialLineups,
        officialLineupStatus: existing.officialLineupStatus,
        officialLineupReceivedAt: existing.officialLineupReceivedAt,
        lineupAccuracy: existing.lineupAccuracy
      };
    }
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

/**
 * Analiz hedef havuzu: elle doğrulanmış matches.json + takvimin resmî
 * Süper Lig fikstürleri. Motor daha önce YALNIZCA matches.json'u okuyordu
 * (12 elle seçilmiş kayıt) — 306 üretilmiş maç sayfası bu yüzden analizsiz
 * kalıyordu. Takvim kayıtları sağlayıcının SAYISAL fixture kimliğini de
 * getirir; resmî 11 tazelemesi (refresh-official-lineups.mjs) o kimliğe
 * muhtaçtır.
 */
function buildTargetPool(rawMatches, calendarMatches) {
  const pool = [...rawMatches];
  for (const candidate of calendarMatches) {
    if (!CALENDAR_TARGET_COMPETITIONS.has(String(candidate.competitionId || ""))) continue;
    if (!candidate.homeTeam || !candidate.awayTeam || !candidate.kickoff) continue;
    if (pool.some((existing) => isSameFixture(existing, candidate))) continue;
    pool.push(candidate);
  }
  return pool;
}

/**
 * Form havuzu: bir takımın "son 5 maçı" için bakılan bitmiş maç kümesi.
 * matches.json tek başına 12 kayıttı; gerçek form ancak arşiv (bitmiş,
 * doğrulanmış maçlar) ve takvimin bitmiş kayıtlarıyla okunabilir. Öncelik
 * elle doğrulanmış kayıtta — aynı maçın iki kopyası havuza girmez, form
 * çift sayılmaz.
 */
function buildFormPool(rawMatches, calendarMatches, archiveRecords) {
  const pool = [...rawMatches];
  const candidates = [
    ...archiveRecords.map((record) => record && record.match).filter(Boolean),
    ...calendarMatches
  ];
  for (const candidate of candidates) {
    if (!candidate.homeTeam || !candidate.awayTeam) continue;
    if (pool.some((existing) => isSameFixture(existing, candidate))) continue;
    pool.push(candidate);
  }
  return pool;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawMatches = readJson(MATCHES_PATH, []);
  const calendar = readJson(CALENDAR_PATH, { matches: [] });
  const calendarMatches = Array.isArray(calendar.matches) ? calendar.matches : [];
  const archive = readJson(ARCHIVE_PATH, { records: [] });
  const archiveRecords = Array.isArray(archive.records) ? archive.records : [];
  const { teams, players } = mergeInternationalData(readJson(TEAMS_PATH, []), readJson(PLAYERS_PATH, []));
  const squadStatus = readJson(SQUAD_STATUS_PATH, { teams: [] });
  const existingAnalyses = readJson(OUTPUT_PATH, []);
  const existingById = new Map(existingAnalyses.map((item) => [item.fixtureId, item]));

  const targetPool = buildTargetPool(rawMatches, calendarMatches);
  const formPool = buildFormPool(rawMatches, calendarMatches, archiveRecords);

  const seenIds = new Set();
  const fixtures = [];
  for (const match of targetPool) {
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
      const fresh = generateFreshAnalysis(fixture, formPool, players, teams, squadStatus);
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

  const serialized = `${JSON.stringify(merged, null, 2)}\n`;
  for (const filePath of [OUTPUT_PATH, PUBLIC_OUTPUT_PATH]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tempPath, serialized);
    fs.renameSync(tempPath, filePath);
  }
  console.log(`Wrote ${merged.length} total record(s) to ${path.relative(root, OUTPUT_PATH)} (+ public mirror).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
