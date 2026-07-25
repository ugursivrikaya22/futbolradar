import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const { generateProbableLineupForFixture } = require("../services/lineupPredictionService.js");
const { normalizeText } = require("../services/matchRadarService.js");

const OUTPUT_PATH = path.join(root, "data", "football-coverage-summary.json");
const SUPER_LIG_LEAGUE_NAME = "Süper Lig";
const MIN_STARTER_COVERAGE_FOR_LINEUP = 55;
const CRITICAL_PLAYER_FLOOR = 100;
const SAFE_PLAYER_TARGET = 300;

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function isRealProviderId(value) {
  return Boolean(value) && !String(value).startsWith("mock-");
}

function hasSeasonStats(player) {
  return [player.goals, player.assists, player.minutesPlayed, player.appearances].some(
    (value) => value !== null && value !== undefined
  );
}

function scoreClamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function main() {
  const teams = readJson(path.join(root, "data", "teams.json"), []);
  const rawPlayers = readJson(path.join(root, "data", "players.json"), []);
  const matches = readJson(path.join(root, "data", "matches.json"), []);
  const superLigFixtures = readJson(path.join(root, "data", "super-lig-fixtures.json"), { rounds: [] });
  const matchAnalyses = readJson(path.join(root, "data", "match-analyses.json"), []);

  const players = getPlayers(rawPlayers);
  const superLigTeams = teams.filter((team) => normalizeText(team.league) === normalizeText(SUPER_LIG_LEAGUE_NAME));
  const superLigTeamNames = new Set(superLigTeams.map((team) => normalizeText(team.name)));

  const superLigPlayers = players.filter((player) => superLigTeamNames.has(normalizeText(player.currentTeam)));

  const playersWithProviderId = players.filter((player) => isRealProviderId(player.providerId));
  const playersWithCurrentTeam = players.filter((player) => Boolean(player.currentTeam));
  const playersWithPosition = players.filter((player) => Boolean(player.position));
  const playersWithSeasonStats = players.filter(hasSeasonStats);
  const playersWithRating = players.filter((player) => Number.isFinite(Number(player.overallRating ?? player.aiRating)));

  const today = new Date().toISOString();
  const teamSquadReports = superLigTeams.map((team) => {
    const squad = players.filter((player) => normalizeText(player.currentTeam) === normalizeText(team.name));
    const dummyFixture = { id: `coverage-audit-${team.id || team.name}`, kickoff: today, officialLineups: {} };
    const lineup = generateProbableLineupForFixture({ name: team.name, players: squad, side: "home" }, dummyFixture, null);

    return {
      team: team.name,
      squadSize: squad.length,
      lineupCoverage: lineup.coverage,
      canGenerateProbableLineup: lineup.coverage >= MIN_STARTER_COVERAGE_FOR_LINEUP,
      squadStatus: squad.length >= 11 ? "complete" : squad.length > 0 ? "partial" : "unavailable"
    };
  });

  const teamsWithCompleteSquad = teamSquadReports.filter((report) => report.squadStatus === "complete").length;
  const teamsWithPartialSquad = teamSquadReports.filter((report) => report.squadStatus === "partial").length;
  const teamsWithInsufficientSquad = teamSquadReports.filter((report) => report.squadStatus === "unavailable").length;
  const teamsThatCanGenerateLineup = teamSquadReports.filter((report) => report.canGenerateProbableLineup).length;

  const fixtureRoundMatchCount = (superLigFixtures.rounds || []).reduce((sum, round) => sum + (round.matches || []).length, 0);
  const now = Date.now();
  const upcomingLeagueFixtures = matches.filter((match) => {
    const isLeague = normalizeText(match.league) === normalizeText(SUPER_LIG_LEAGUE_NAME);
    const kickoffTime = match.kickoff ? new Date(match.kickoff).getTime() : NaN;
    const isScheduled = String(match.status || "").toUpperCase() === "SCHEDULED";
    return isLeague && isScheduled && Number.isFinite(kickoffTime) && kickoffTime >= now;
  }).length;
  const friendlyFixtures = matches.filter((match) => match.competitionId === "hazirlik-maci" || normalizeText(match.league).includes("hazirlik")).length;

  const officialLineupCount = matchAnalyses.filter((record) => {
    return record.officialLineups && (record.officialLineups.home || record.officialLineups.away);
  }).length;
  const analysisStatusCounts = matchAnalyses.reduce((acc, record) => {
    const key = record.analysisStatus || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const averagePlayersPerTeam = superLigTeams.length ? Number((superLigPlayers.length / superLigTeams.length).toFixed(2)) : 0;

  const componentScores = {
    squadCoverage: superLigTeams.length ? scoreClamp((teamsWithCompleteSquad / superLigTeams.length) * 100) : 0,
    playerMetadataCoverage: players.length
      ? scoreClamp(((playersWithCurrentTeam.length + playersWithPosition.length) / (players.length * 2)) * 100)
      : 0,
    lineupFeasibility: superLigTeams.length ? scoreClamp((teamsThatCanGenerateLineup / superLigTeams.length) * 100) : 0,
    fixtureReadiness: matches.length ? 60 : 0,
    officialLineupCoverage: matchAnalyses.length ? scoreClamp((officialLineupCount / matchAnalyses.length) * 100) : 0
  };
  const coverageScore = scoreClamp(
    (componentScores.squadCoverage * 0.35 +
      componentScores.playerMetadataCoverage * 0.2 +
      componentScores.lineupFeasibility * 0.25 +
      componentScores.fixtureReadiness * 0.1 +
      componentScores.officialLineupCoverage * 0.1)
  );

  const criticalIssues = [];
  const warnings = [];

  if (superLigPlayers.length < CRITICAL_PLAYER_FLOOR) {
    criticalIssues.push(
      `Süper Lig oyuncu sayısı kritik eşiğin altında: ${superLigPlayers.length}/${CRITICAL_PLAYER_FLOOR}. ` +
      "Muhtemel ilk 11 ve kilit eşleşme motorları çoğu maçta 'yetersiz veri' dönecek."
    );
  } else if (superLigPlayers.length < SAFE_PLAYER_TARGET) {
    warnings.push(`Süper Lig oyuncu sayısı hedefin altında: ${superLigPlayers.length}/${SAFE_PLAYER_TARGET}.`);
  }
  if (playersWithProviderId.length === 0) {
    criticalIssues.push("Hiçbir oyuncuda gerçek provider ID yok; tüm kimlikler mock/sentetik.");
  }
  if (officialLineupCount === 0 && matchAnalyses.length > 0) {
    warnings.push("Hiçbir maç analizinde resmî ilk 11 bulunmuyor (provider entegrasyonu henüz canlı değil).");
  }
  if (teamsWithInsufficientSquad > 0) {
    warnings.push(`${teamsWithInsufficientSquad} takımın kadro verisi tamamen eksik.`);
  }
  if (upcomingLeagueFixtures === 0) {
    warnings.push("Yaklaşan doğrulanmış Süper Lig ligi maçı bulunamadı (sezon henüz başlamamış olabilir).");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    season: new Date().getUTCMonth() >= 6 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1,
    teamCount: superLigTeams.length,
    currentPlayerCount: players.length,
    currentSuperLigPlayerCount: superLigPlayers.length,
    averagePlayersPerTeam,
    playersWithProviderId: playersWithProviderId.length,
    playersWithCurrentTeam: playersWithCurrentTeam.length,
    playersWithPosition: playersWithPosition.length,
    playersWithSeasonStats: playersWithSeasonStats.length,
    playersWithRating: playersWithRating.length,
    teamsWithCompleteSquad,
    teamsWithPartialSquad,
    teamsWithInsufficientSquad,
    teamsThatCanGenerateProbableLineup: teamsThatCanGenerateLineup,
    fixtureCount: matches.length,
    fixtureRoundMatchCount,
    upcomingLeagueFixtureCount: upcomingLeagueFixtures,
    friendlyFixtureCount: friendlyFixtures,
    officialLineupCount,
    matchAnalysisCounts: {
      complete: analysisStatusCounts.complete || 0,
      partial: analysisStatusCounts.partial || 0,
      unavailable: analysisStatusCounts.unavailable || 0,
      stale: analysisStatusCounts.stale || 0
    },
    componentScores,
    coverageScore,
    teamSquadReports,
    criticalIssues,
    warnings
  };

  const tempPath = `${OUTPUT_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(summary, null, 2)}\n`);
  fs.renameSync(tempPath, OUTPUT_PATH);

  console.log(`Coverage score: ${coverageScore}/100`);
  console.log(`Süper Lig teams: ${superLigTeams.length}, Süper Lig players: ${superLigPlayers.length} (avg ${averagePlayersPerTeam}/team)`);
  console.log(`Teams with complete/partial/insufficient squad: ${teamsWithCompleteSquad}/${teamsWithPartialSquad}/${teamsWithInsufficientSquad}`);
  console.log(`Teams that can generate a probable lineup (>=${MIN_STARTER_COVERAGE_FOR_LINEUP}% coverage): ${teamsThatCanGenerateLineup}/${superLigTeams.length}`);
  console.log(`Match analyses: complete=${summary.matchAnalysisCounts.complete} partial=${summary.matchAnalysisCounts.partial} unavailable=${summary.matchAnalysisCounts.unavailable}`);
  if (criticalIssues.length) {
    console.log("\nCRITICAL ISSUES:");
    criticalIssues.forEach((issue) => console.log(`  - ${issue}`));
  }
  if (warnings.length) {
    console.log("\nWarnings:");
    warnings.forEach((warning) => console.log(`  - ${warning}`));
  }
  console.log(`\nWrote ${path.relative(root, OUTPUT_PATH)}`);
}

main();
