const COMPONENT_WEIGHTS = Object.freeze({
  homeSquadCoverage: 15,
  awaySquadCoverage: 15,
  homeStatsCoverage: 10,
  awayStatsCoverage: 10,
  recentFormCoverage: 15,
  teamAnalysisCoverage: 15,
  probableLineupCoverage: 15,
  officialLineupCoverage: 5
});

const MISSING_COMPONENT_LABELS = Object.freeze({
  homeSquadCoverage: "Ev sahibi kadro kapsamı yetersiz",
  awaySquadCoverage: "Deplasman kadro kapsamı yetersiz",
  homeStatsCoverage: "Ev sahibi için güncel oyuncu verileri tamamlanıyor",
  awayStatsCoverage: "Deplasman için güncel oyuncu verileri tamamlanıyor",
  recentFormCoverage: "Son maç formu için yeterli doğrulanmış veri yok",
  teamAnalysisCoverage: "Takım analizi için yeterli veri yok",
  probableLineupCoverage: "Muhtemel ilk 11 için yeterli kadro verisi yok",
  officialLineupCoverage: "Resmî ilk 11 henüz açıklanmadı"
});

const LOW_COVERAGE_THRESHOLD = 40;

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function ratio(count, total) {
  return total > 0 ? clamp((count / total) * 100, 0, 100) : 0;
}

function statsCoverageFor(squadPlayers) {
  const players = Array.isArray(squadPlayers) ? squadPlayers : [];
  if (!players.length) return 0;
  const withStats = players.filter((player) => Number.isFinite(Number(player.overallRating ?? player.aiRating)));
  return ratio(withStats.length, players.length);
}

/**
 * Combines every layer that already exists in a match-analysis build
 * (radar coverage, lineup coverage, form sample size, official lineup
 * presence) into one honest coverage/confidence summary — this is the
 * single signal the generator uses to decide whether a "complete" analysis
 * label is warranted, and what the UI shows as a non-technical status.
 */
function computeAnalysisCoverage({ home, away, homeContext, awayContext, homeSquad, awaySquad, officialLineupStatus }) {
  const components = {
    homeSquadCoverage: (home && home.lineup && home.lineup.coverage) ?? 0,
    awaySquadCoverage: (away && away.lineup && away.lineup.coverage) ?? 0,
    homeStatsCoverage: statsCoverageFor(homeSquad),
    awayStatsCoverage: statsCoverageFor(awaySquad),
    recentFormCoverage: clamp(
      (((homeContext && homeContext.recentForm && homeContext.recentForm.sampleSize) || 0) +
        ((awayContext && awayContext.recentForm && awayContext.recentForm.sampleSize) || 0)) / 10 * 100,
      0,
      100
    ),
    teamAnalysisCoverage: clamp((((home && home.radar && home.radar.coverage) || 0) + ((away && away.radar && away.radar.coverage) || 0)) / 2, 0, 100),
    probableLineupCoverage: clamp((((home && home.lineup && home.lineup.coverage) || 0) + ((away && away.lineup && away.lineup.coverage) || 0)) / 2, 0, 100),
    officialLineupCoverage: officialLineupStatus === "available" ? 100 : 0
  };

  const totalWeight = Object.values(COMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const overallCoverage = Math.round(
    Object.entries(COMPONENT_WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0) / totalWeight
  );

  let confidenceLevel = "unavailable";
  if (overallCoverage >= 65) confidenceLevel = "high";
  else if (overallCoverage >= 40) confidenceLevel = "medium";
  else if (overallCoverage > 0) confidenceLevel = "low";

  const missingComponents = Object.entries(components)
    .filter(([key, value]) => value < LOW_COVERAGE_THRESHOLD && key !== "officialLineupCoverage")
    .map(([key]) => MISSING_COMPONENT_LABELS[key]);
  if (components.officialLineupCoverage === 0) {
    missingComponents.push(MISSING_COMPONENT_LABELS.officialLineupCoverage);
  }

  return {
    ...components,
    overallCoverage,
    confidenceLevel,
    missingComponents
  };
}

/**
 * The lineup-refresh job only has the stored match-analysis record, not the
 * full team/player bundles the generator used — this cheaply patches an
 * already-computed coverage object once an official lineup arrives, without
 * needing to rebuild the whole coverage calculation from scratch.
 */
function applyOfficialLineupToCoverage(coverage) {
  if (!coverage) return coverage;
  const components = { ...coverage, officialLineupCoverage: 100 };
  const totalWeight = Object.values(COMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const overallCoverage = Math.round(
    Object.entries(COMPONENT_WEIGHTS).reduce((sum, [key, weight]) => sum + (components[key] ?? 0) * weight, 0) / totalWeight
  );

  let confidenceLevel = "unavailable";
  if (overallCoverage >= 65) confidenceLevel = "high";
  else if (overallCoverage >= 40) confidenceLevel = "medium";
  else if (overallCoverage > 0) confidenceLevel = "low";

  const missingComponents = (coverage.missingComponents || []).filter(
    (label) => label !== MISSING_COMPONENT_LABELS.officialLineupCoverage
  );

  return { ...components, overallCoverage, confidenceLevel, missingComponents };
}

/**
 * Faz 9 guard: full "complete" analysis requires both squads and lineups
 * to clear a real bar — an 8-player total dataset must never present as
 * "complete" just because the math happens to average out.
 */
function analysisStatusFromCoverage(coverage) {
  if (!coverage || coverage.overallCoverage === 0) return "unavailable";
  if (
    coverage.confidenceLevel === "high" &&
    coverage.homeSquadCoverage >= 55 &&
    coverage.awaySquadCoverage >= 55 &&
    coverage.probableLineupCoverage >= 55
  ) {
    return "complete";
  }
  return "partial";
}

module.exports = {
  computeAnalysisCoverage,
  analysisStatusFromCoverage,
  applyOfficialLineupToCoverage,
  LOW_COVERAGE_THRESHOLD,
  COMPONENT_WEIGHTS
};
