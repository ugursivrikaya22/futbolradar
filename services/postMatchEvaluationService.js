const { compareProbableAndOfficialLineup } = require("./lineupPredictionService");

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

function isNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

/**
 * home/draw/away from a final score. Returns null when the score isn't a
 * confirmed final result yet — callers must never guess an outcome.
 */
function determineOutcome(score) {
  if (!score || !isNumber(score.home) || !isNumber(score.away)) {
    return null;
  }
  const home = Number(score.home);
  const away = Number(score.away);
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

/**
 * Only ever reads the frozen snapshot's own prediction — never a
 * re-generated one — so a post-match run can't retroactively "improve"
 * a pre-match call with hindsight.
 */
function evaluateOutcomePrediction(snapshot, finalResult) {
  const predictedPrimary = snapshot && snapshot.prediction && snapshot.prediction.primary || null;
  const actualOutcome = determineOutcome(finalResult && finalResult.score);

  if (!predictedPrimary || !actualOutcome) {
    return { predictedPrimary: predictedPrimary || null, actualOutcome, outcomeHit: null };
  }

  const outcomeHit = predictedPrimary === actualOutcome ||
    (predictedPrimary === "balanced" && actualOutcome === "draw");

  return { predictedPrimary, actualOutcome, outcomeHit };
}

function evaluateProbabilityAssignment(snapshot, finalResult) {
  const probabilities = snapshot && snapshot.prediction && snapshot.prediction.probabilities;
  const actualOutcome = determineOutcome(finalResult && finalResult.score);

  if (!probabilities || !actualOutcome) {
    return { probabilityAssignedToActualOutcome: null };
  }

  const key = actualOutcome === "home" ? "homeWin" : actualOutcome === "away" ? "awayWin" : "draw";
  const value = probabilities[key];
  return { probabilityAssignedToActualOutcome: isNumber(value) ? Number(value) : null };
}

/**
 * Multi-class Brier score across {home, draw, away}: sum of squared
 * differences between each forecast probability and the one-hot actual
 * outcome. 0 = perfect, 2 = worst possible for a 3-way categorical forecast.
 * Internal technical metric only — never surfaced to users as-is.
 */
function computeBrierScore(snapshot, finalResult) {
  const probabilities = snapshot && snapshot.prediction && snapshot.prediction.probabilities;
  const actualOutcome = determineOutcome(finalResult && finalResult.score);

  if (!probabilities || !actualOutcome) {
    return null;
  }

  const outcomes = ["home", "draw", "away"];
  const probKeys = { home: "homeWin", draw: "draw", away: "awayWin" };

  const sumSquares = outcomes.reduce((sum, outcome) => {
    const forecast = clamp(probabilities[probKeys[outcome]], 0, 100) / 100;
    const actual = outcome === actualOutcome ? 1 : 0;
    return sum + (forecast - actual) ** 2;
  }, 0);

  return Number(sumSquares.toFixed(4));
}

function goalBand(totalGoals) {
  if (!isNumber(totalGoals)) return null;
  if (totalGoals < 2) return "low";
  if (totalGoals <= 3) return "medium";
  return "high";
}

/**
 * Compares the frozen snapshot's goalPotential label against the actual
 * combined goals band. "unavailable" when either side is missing —
 * never guessed.
 */
function evaluateGoalPotential(snapshot, finalScore) {
  const predictedLabel = snapshot && snapshot.goalPotential && snapshot.goalPotential.label;
  if (!predictedLabel || !finalScore || !isNumber(finalScore.home) || !isNumber(finalScore.away)) {
    return "unavailable";
  }

  const actualBand = goalBand(Number(finalScore.home) + Number(finalScore.away));
  if (!actualBand) return "unavailable";
  return actualBand === predictedLabel ? "hit" : "miss";
}

/**
 * "Upset" is only a meaningful concept once the model actually named a
 * favorite. A balanced/low-confidence call (like this fixture's 33/34/33)
 * never gets scored as an upset either way.
 */
function evaluateUpsetRisk(snapshot, finalResult) {
  const predictedPrimary = snapshot && snapshot.prediction && snapshot.prediction.primary;
  const actualOutcome = determineOutcome(finalResult && finalResult.score);

  if (!predictedPrimary || predictedPrimary === "balanced" || predictedPrimary === "draw" || !actualOutcome) {
    return { status: "not-applicable", note: "Model belirgin bir favori öngörmediği için sürpriz riski değerlendirilemez." };
  }

  const upsetOccurred = predictedPrimary !== actualOutcome;
  return { status: upsetOccurred ? "upset-occurred" : "no-upset", predictedFavorite: predictedPrimary, actualOutcome };
}

/**
 * Only ever runs when an official lineup exists — an unproduced probable
 * lineup (Monza's case here) must report "insufficient data", never a
 * fabricated accuracy number.
 */
function evaluateLineupAccuracy(probable, official) {
  if (!official || !Array.isArray(official.starters) || !official.starters.length) {
    return { status: "unavailable", accuracy: null, note: "Maç öncesi kadro verisi yetersiz olduğundan doğrulanabilir bir ilk 11 tahmini üretilemedi." };
  }

  if (!probable || !Array.isArray(probable.starters) || !probable.starters.length) {
    return { status: "unavailable", accuracy: null, note: "Maç öncesi kadro verisi yetersiz olduğundan doğrulanabilir bir ilk 11 tahmini üretilemedi." };
  }

  const comparison = compareProbableAndOfficialLineup(probable, official);
  return {
    status: comparison.available ? "complete" : "unavailable",
    accuracy: comparison.accuracy,
    matches: comparison.matches,
    total: comparison.total,
    missedPlayers: comparison.missedPlayers
  };
}

/**
 * Free-text key matchups (this fixture's `keyMatchups`) can't be scored —
 * only structured {homePlayer, awayPlayer} duels (matchupService's
 * generateKeyDuels output) can be checked against an official lineup.
 */
function evaluateKeyDuels(keyDuels, officialLineups, events) {
  if (!Array.isArray(keyDuels) || !keyDuels.length) {
    return { status: "unavailable", note: "Maç öncesi kilit eşleşme üretilemediği için değerlendirme yapılamıyor.", duels: [] };
  }

  const homeStarters = (officialLineups && officialLineups.home && officialLineups.home.starters) || [];
  const awayStarters = (officialLineups && officialLineups.away && officialLineups.away.starters) || [];
  if (!homeStarters.length && !awayStarters.length) {
    return { status: "unavailable", note: "Resmî ilk 11 açıklanmadığından kilit eşleşmeler doğrulanamıyor.", duels: [] };
  }

  const playedIds = new Set(
    [...homeStarters, ...awayStarters].map((player) => normalizeText(player.id || player.name))
  );

  const duels = keyDuels.map((duel) => {
    const homeKey = normalizeText(duel.homePlayer && (duel.homePlayer.id || duel.homePlayer.name));
    const awayKey = normalizeText(duel.awayPlayer && (duel.awayPlayer.id || duel.awayPlayer.name));
    const homePlayed = homeKey ? playedIds.has(homeKey) : null;
    const awayPlayed = awayKey ? playedIds.has(awayKey) : null;

    return {
      title: duel.title || null,
      homePlayer: duel.homePlayer && duel.homePlayer.name,
      awayPlayer: duel.awayPlayer && duel.awayPlayer.name,
      status: homePlayed === null || awayPlayed === null
        ? "unknown"
        : homePlayed && awayPlayed ? "both-started" : homePlayed || awayPlayed ? "one-started" : "neither-started"
    };
  });

  return { status: "complete", note: null, duels };
}

/**
 * Orchestrates every evaluator for a single frozen snapshot. `result`
 * carries { snapshot, finalResult: { score, events, officialLineups },
 * probableLineups, keyDuels }. Never mutates the snapshot it reads.
 */
function buildPostMatchEvaluation(result) {
  const snapshot = result && result.snapshot;
  const finalResult = result && result.finalResult;

  if (!snapshot) {
    return {
      snapshotId: null,
      snapshotType: null,
      evaluationStatus: "unavailable",
      summary: "Değerlendirilecek dondurulmuş maç öncesi snapshot bulunamadı."
    };
  }

  const outcomeEval = evaluateOutcomePrediction(snapshot, finalResult);
  const probabilityEval = evaluateProbabilityAssignment(snapshot, finalResult);
  const brierScore = computeBrierScore(snapshot, finalResult);
  const goalPotentialResult = evaluateGoalPotential(snapshot, finalResult && finalResult.score);
  const upsetEval = evaluateUpsetRisk(snapshot, finalResult);
  const lineupAccuracy = evaluateLineupAccuracy(
    result && result.probableLineups,
    finalResult && finalResult.officialLineups
  );
  const keyDuelsEval = evaluateKeyDuels(
    result && result.keyDuels,
    finalResult && finalResult.officialLineups,
    finalResult && finalResult.events
  );

  const hasFinalResult = Boolean(outcomeEval.actualOutcome);
  const evaluationStatus = !hasFinalResult
    ? "unavailable"
    : snapshot.dataConfidence < 25
      ? "partial"
      : "complete";

  const summary = !hasFinalResult
    ? "Maç henüz sonuçlanmadığı için değerlendirme yapılamıyor."
    : snapshot.dataConfidence < 25
      ? "Veri güveni düşük olduğu için model belirgin taraf seçemedi; bu doğal bir sınırlamadır."
      : outcomeEval.outcomeHit
        ? "Model, gerçekleşen sonucu doğru öngördü."
        : "Model, gerçekleşen sonucu öngöremedi.";

  return {
    snapshotId: snapshot.snapshotId || null,
    snapshotType: snapshot.snapshotType || null,
    actualOutcome: outcomeEval.actualOutcome,
    predictedPrimary: outcomeEval.predictedPrimary,
    probabilityAssignedToActualOutcome: probabilityEval.probabilityAssignedToActualOutcome,
    outcomeHit: outcomeEval.outcomeHit,
    brierScore,
    goalPotentialResult,
    upsetRiskEvaluation: upsetEval,
    lineupAccuracy,
    keyDuelsEvaluation: keyDuelsEval,
    dataConfidenceAtPrediction: isNumber(snapshot.dataConfidence) ? Number(snapshot.dataConfidence) : null,
    evaluationStatus,
    summary
  };
}

module.exports = {
  determineOutcome,
  evaluateOutcomePrediction,
  evaluateProbabilityAssignment,
  computeBrierScore,
  evaluateGoalPotential,
  evaluateUpsetRisk,
  evaluateLineupAccuracy,
  evaluateKeyDuels,
  buildPostMatchEvaluation
};
