const MODEL_VERSION = "futbolradar-match-v1";
const HOME_ADVANTAGE_POINTS = 4;
const BASELINE_STRENGTH = 55;

const STRENGTH_WEIGHTS = Object.freeze({
  radar: 25,
  lineup: 20,
  recentForm: 20,
  venueForm: 15,
  bench: 10,
  availability: 10
});

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function isNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

/**
 * Blends a component score toward a neutral baseline when its own coverage
 * is thin, so a single known player or a two-match sample can't swing the
 * team strength as hard as a fully-covered component would.
 */
function regressToMean(value, coverage0to100) {
  if (!isNumber(value)) return null;
  const weight = clamp(coverage0to100, 0, 100) / 100;
  return Number(value) * weight + BASELINE_STRENGTH * (1 - weight);
}

function normalizeToHundred(parts) {
  const rounded = parts.map((part) => Math.round(part));
  const drift = 100 - rounded.reduce((sum, value) => sum + value, 0);
  if (drift !== 0 && rounded.length) {
    const largestIndex = rounded.reduce((bestIndex, value, index, arr) => (value > arr[bestIndex] ? index : bestIndex), 0);
    rounded[largestIndex] += drift;
  }
  return rounded;
}

function computeMatchTeamStrength(team, context) {
  const radar = team && team.radar;
  const lineup = team && team.lineup;
  const lineupStrength = team && team.lineupStrength;
  const benchStrength = team && team.benchStrength;
  const recentForm = context && context.recentForm;
  const venueForm = context && context.venueForm;

  const components = {
    radar: radar && isNumber(radar.score) ? regressToMean(radar.score, radar.coverage ?? 0) : null,
    lineup: lineupStrength && isNumber(lineupStrength.score) ? regressToMean(lineupStrength.score, lineup ? lineup.coverage : 0) : null,
    recentForm: recentForm && isNumber(recentForm.weightedScore)
      ? regressToMean(recentForm.weightedScore, (recentForm.sampleSize / 5) * 100)
      : null,
    venueForm: venueForm && isNumber(venueForm.weightedScore)
      ? regressToMean(venueForm.weightedScore, (venueForm.sampleSize / 5) * 100)
      : null,
    bench: benchStrength && isNumber(benchStrength.score) ? regressToMean(benchStrength.score, benchStrength.confidence ?? 0) : null,
    availability: lineup && lineup.availability && lineup.availability.totalKnownPlayers
      ? regressToMean(clamp(100 - lineup.availability.unavailableCount * 15, 0, 100), lineup.availability.knownAvailabilityCoverage)
      : null
  };

  const available = Object.entries(STRENGTH_WEIGHTS).filter(([key]) => components[key] !== null);
  const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);

  if (!totalWeight) {
    return { score: null, confidence: 0, components };
  }

  const score = clamp(
    Math.round(available.reduce((sum, [key, weight]) => sum + components[key] * weight, 0) / totalWeight),
    0,
    100
  );
  const confidence = Math.round((totalWeight / 100) * 100);

  return { score, confidence, components };
}

function computeDrawProbability(homeStrength, awayStrength) {
  if (!isNumber(homeStrength) || !isNumber(awayStrength)) {
    return 25;
  }

  const diff = Math.abs(Number(homeStrength) - Number(awayStrength));
  const closeness = clamp(1 - diff / 40, 0, 1);
  return clamp(22 + closeness * 14, 15, 38);
}

function computeOutcomeProbabilities(homeStrength, awayStrength, context) {
  const dataConfidence = clamp((context && context.dataConfidence) ?? 0, 0, 100);

  if (!isNumber(homeStrength) || !isNumber(awayStrength)) {
    return { homeWin: 33, draw: 34, awayWin: 33 };
  }

  const effectiveHome = Number(homeStrength) + HOME_ADVANTAGE_POINTS;
  const effectiveAway = Number(awayStrength);
  const diff = effectiveHome - effectiveAway;

  const drawProb = computeDrawProbability(homeStrength, awayStrength);
  const remaining = 100 - drawProb;
  const homeShare = 1 / (1 + Math.exp(-diff / 12));
  let homeWin = remaining * homeShare;
  let awayWin = remaining * (1 - homeShare);

  // Low data confidence must not produce sharp probabilities: pull the split
  // toward a neutral baseline proportional to how little we actually know.
  const neutralization = 1 - dataConfidence / 100;
  const neutralHome = remaining / 2;
  const neutralAway = remaining / 2;
  homeWin = homeWin * (1 - neutralization) + neutralHome * neutralization;
  awayWin = awayWin * (1 - neutralization) + neutralAway * neutralization;

  const [home, draw, away] = normalizeToHundred([homeWin, drawProb, awayWin]);
  return { homeWin: home, draw, awayWin: away };
}

function computeGoalPotential(homeContext, awayContext) {
  const homeAttack = homeContext && homeContext.goalTrend ? homeContext.goalTrend.averageGoalsFor : null;
  const awayAttack = awayContext && awayContext.goalTrend ? awayContext.goalTrend.averageGoalsFor : null;
  const homeDefenseConceded = homeContext && homeContext.defensiveTrend ? homeContext.defensiveTrend.averageGoalsAgainst : null;
  const awayDefenseConceded = awayContext && awayContext.defensiveTrend ? awayContext.defensiveTrend.averageGoalsAgainst : null;

  const inputs = [homeAttack, awayAttack, homeDefenseConceded, awayDefenseConceded].filter(isNumber);
  if (!inputs.length) {
    return { score: null, label: null, expectedCombinedGoals: null };
  }

  const attackComponents = [homeAttack, awayAttack].filter(isNumber);
  const concededComponents = [homeDefenseConceded, awayDefenseConceded].filter(isNumber);
  const attackAverage = attackComponents.length ? attackComponents.reduce((sum, value) => sum + value, 0) / attackComponents.length : 1.2;
  const concededAverage = concededComponents.length ? concededComponents.reduce((sum, value) => sum + value, 0) / concededComponents.length : 1.2;
  const expectedCombinedGoals = Number((attackAverage + concededAverage).toFixed(2));

  const score = clamp(Math.round(goalPotentialScore(expectedCombinedGoals)), 0, 100);
  const label = expectedCombinedGoals < 2.2 ? "low" : expectedCombinedGoals <= 3.0 ? "medium" : "high";

  return { score, label, expectedCombinedGoals };
}

// Piecewise mapping so the numeric score visually agrees with its label
// band (low/medium/high) instead of a raw linear scale that overshoots.
function goalPotentialScore(expectedCombinedGoals) {
  const breakpoints = [
    { goals: 0, score: 0 },
    { goals: 2.2, score: 40 },
    { goals: 3.0, score: 70 },
    { goals: 4.5, score: 100 }
  ];

  if (expectedCombinedGoals <= breakpoints[0].goals) return breakpoints[0].score;
  if (expectedCombinedGoals >= breakpoints[breakpoints.length - 1].goals) return breakpoints[breakpoints.length - 1].score;

  for (let i = 0; i < breakpoints.length - 1; i += 1) {
    const start = breakpoints[i];
    const end = breakpoints[i + 1];
    if (expectedCombinedGoals >= start.goals && expectedCombinedGoals <= end.goals) {
      const ratio = (expectedCombinedGoals - start.goals) / (end.goals - start.goals);
      return start.score + ratio * (end.score - start.score);
    }
  }

  return 50;
}

function computeMatchBalance(matchAnalysis) {
  const homeStrength = matchAnalysis && matchAnalysis.teamStrength ? matchAnalysis.teamStrength.home : null;
  const awayStrength = matchAnalysis && matchAnalysis.teamStrength ? matchAnalysis.teamStrength.away : null;

  if (!isNumber(homeStrength) || !isNumber(awayStrength)) {
    return { score: null, label: null };
  }

  const diff = Number(homeStrength) - Number(awayStrength);
  const score = clamp(Math.round(100 - Math.abs(diff) * 2), 0, 100);
  let label = "balanced";
  if (Math.abs(diff) >= 12) {
    label = diff > 0 ? "strong-home" : "strong-away";
  } else if (Math.abs(diff) >= 5) {
    label = diff > 0 ? "slight-home" : "slight-away";
  }

  return { score, label };
}

function computeUpsetRisk(matchAnalysis) {
  const probabilities = matchAnalysis && matchAnalysis.probabilities;
  const dataConfidence = clamp((matchAnalysis && matchAnalysis.dataConfidence) ?? 0, 0, 100);

  if (!probabilities || !isNumber(probabilities.homeWin) || !isNumber(probabilities.awayWin)) {
    return { score: null, label: null };
  }

  const favoriteWinProb = Math.max(probabilities.homeWin, probabilities.awayWin);
  const uncertaintyBonus = (100 - dataConfidence) * 0.2;
  const score = clamp(Math.round(100 - favoriteWinProb + uncertaintyBonus), 0, 100);
  const label = score < 35 ? "low" : score <= 55 ? "medium" : "high";

  return { score, label };
}

function computePredictionConfidence(matchAnalysis) {
  const dataConfidence = clamp((matchAnalysis && matchAnalysis.dataConfidence) ?? 0, 0, 100);
  const balance = matchAnalysis && matchAnalysis.matchBalance;
  const veryBalancedPenalty = balance && balance.score !== null && balance.score >= 90 ? 5 : 0;
  return clamp(Math.round(dataConfidence - veryBalancedPenalty), 0, 100);
}

function primaryOutcome(probabilities, matchBalance) {
  if (!probabilities) return "balanced";
  const { homeWin, draw, awayWin } = probabilities;
  const top = Math.max(homeWin, draw, awayWin);

  if (matchBalance && matchBalance.label === "balanced" && Math.abs(homeWin - awayWin) <= 6) {
    return "balanced";
  }
  if (top === draw) return "draw";
  return homeWin > awayWin ? "home" : "away";
}

function outcomeLabel(primary, probabilities) {
  if (!probabilities) {
    return "Tahmin hazırlanıyor";
  }
  if (primary === "balanced") return "İki takım da dengeli görünüyor";
  if (primary === "draw") return "Beraberlik ihtimali öne çıkıyor";
  if (primary === "home") {
    return probabilities.homeWin - probabilities.awayWin >= 15 ? "Ev sahibi net önde" : "Ev sahibi bir adım önde";
  }
  return probabilities.awayWin - probabilities.homeWin >= 15 ? "Deplasman net önde" : "Deplasman bir adım önde";
}

function buildPredictionExplanation(prediction) {
  if (!prediction || prediction.predictionStatus === "unavailable") {
    return "Maç öncesi tahmin için yeterli doğrulanmış veri oluşmadı; bu bölüm veri arttıkça güncellenecek.";
  }

  const { probabilities, dataConfidence, teamStrength, matchBalance } = prediction;
  const parts = [
    `Model, ev sahibi için %${probabilities.homeWin}, beraberlik için %${probabilities.draw}, deplasman için %${probabilities.awayWin} ihtimal hesaplıyor.`,
    isNumber(teamStrength && teamStrength.home) && isNumber(teamStrength && teamStrength.away)
      ? `Takım güç puanları ${teamStrength.home}/100 - ${teamStrength.away}/100 ve maç dengesi "${matchBalance && matchBalance.label}" olarak okunuyor.`
      : null,
    `Bu okuma ${dataConfidence}/100 veri güveniyle üretildi; ${dataConfidence < 45 ? "düşük güven nedeniyle temkinli değerlendirilmeli." : "orta-yüksek güven seviyesinde."}`
  ].filter(Boolean);

  return parts.join(" ");
}

function freezePreMatchPrediction(fixture, prediction) {
  return {
    ...prediction,
    frozenAt: new Date().toISOString(),
    frozenKickoff: (fixture && (fixture.kickoff || fixture.date)) || null
  };
}

function buildMatchPrediction(fixture, homeTeam, awayTeam, homeContext, awayContext, matchupComparison) {
  const confidenceInputs = [
    homeContext && homeContext.confidence,
    awayContext && awayContext.confidence,
    homeTeam && homeTeam.lineup && homeTeam.lineup.confidence,
    awayTeam && awayTeam.lineup && awayTeam.lineup.confidence,
    matchupComparison && matchupComparison.confidence
  ].filter(isNumber);
  const dataConfidence = confidenceInputs.length
    ? Math.round(confidenceInputs.reduce((sum, value) => sum + Number(value), 0) / confidenceInputs.length)
    : 0;

  const homeStrength = computeMatchTeamStrength(homeTeam, { recentForm: homeContext && homeContext.recentForm, venueForm: homeContext && homeContext.homeForm });
  const awayStrength = computeMatchTeamStrength(awayTeam, { recentForm: awayContext && awayContext.recentForm, venueForm: awayContext && awayContext.awayForm });

  const probabilities = computeOutcomeProbabilities(homeStrength.score, awayStrength.score, { dataConfidence });
  const goalPotential = computeGoalPotential(homeContext, awayContext);

  const partial = {
    modelVersion: MODEL_VERSION,
    dataConfidence,
    teamStrength: { home: homeStrength.score, away: awayStrength.score },
    probabilities
  };

  const matchBalance = computeMatchBalance(partial);
  const upsetRisk = computeUpsetRisk({ ...partial, matchBalance });
  const predictionConfidence = computePredictionConfidence({ ...partial, matchBalance });

  let predictionStatus = "available";
  if (homeStrength.score === null && awayStrength.score === null) {
    predictionStatus = "unavailable";
  } else if (dataConfidence < 45 || homeStrength.score === null || awayStrength.score === null) {
    predictionStatus = "low-confidence";
  }

  const primary = predictionStatus === "unavailable" ? "balanced" : primaryOutcome(probabilities, matchBalance);
  const warnings = [];
  if (predictionStatus === "unavailable") warnings.push("insufficient-data-for-prediction");
  if (predictionStatus === "low-confidence") warnings.push("low-confidence-prediction");
  if (goalPotential.score === null) warnings.push("goal-potential-unavailable");

  const prediction = {
    modelVersion: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    asOf: (fixture && (fixture.kickoff || fixture.date)) || null,
    predictionStatus,
    dataConfidence,
    teamStrength: { home: homeStrength.score, away: awayStrength.score },
    probabilities,
    prediction: {
      primary,
      label: predictionStatus === "unavailable" ? "Tahmin hazırlanıyor" : outcomeLabel(primary, probabilities),
      confidence: predictionConfidence
    },
    goalPotential: { score: goalPotential.score, label: goalPotential.label },
    upsetRisk,
    matchBalance,
    summary: "",
    warnings
  };

  prediction.summary = buildPredictionExplanation(prediction);
  return prediction;
}

module.exports = {
  MODEL_VERSION,
  buildMatchPrediction,
  computeMatchTeamStrength,
  computeOutcomeProbabilities,
  computeDrawProbability,
  computeGoalPotential,
  computeUpsetRisk,
  computeMatchBalance,
  computePredictionConfidence,
  buildPredictionExplanation,
  freezePreMatchPrediction
};
