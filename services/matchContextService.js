const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN"]);
const FRIENDLY_COMPETITION_IDS = new Set(["hazirlik-maci"]);
const RECENT_FORM_LIMIT = 5;
const SCHEDULE_LOAD_WINDOW_DAYS = 14;
const RECENCY_WEIGHTS = [1, 0.92, 0.84, 0.76, 0.68];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.max(min, Math.min(max, number));
}

function teamKey(team) {
  if (!team) return "";
  if (typeof team === "string") return normalizeText(team);
  return normalizeText(team.name || team.team || team.id || "");
}

function isFriendly(match) {
  if (FRIENDLY_COMPETITION_IDS.has(match.competitionId)) {
    return true;
  }
  return normalizeText(match.league).includes("hazirlik");
}

function matchSide(match, key) {
  if (normalizeText(match.homeTeam) === key) return "home";
  if (normalizeText(match.awayTeam) === key) return "away";
  return null;
}

function matchKickoffTime(match) {
  const value = match && (match.kickoff || match.date);
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

/**
 * Only matches that are FINISHED and kicked off strictly before the fixture's
 * own kickoff are eligible — this is the guard against post-match data
 * leaking into a pre-match analysis.
 */
function eligiblePriorMatches(team, fixtureKickoff, matches) {
  const key = teamKey(team);
  const fixtureTime = new Date(fixtureKickoff);
  if (!key || Number.isNaN(fixtureTime.getTime())) {
    return [];
  }

  return (Array.isArray(matches) ? matches : [])
    .filter((match) => FINISHED_STATUSES.has(String(match.status || "").toUpperCase()))
    .map((match) => ({ match, side: matchSide(match, key), kickoffTime: matchKickoffTime(match) }))
    .filter((entry) => entry.side && entry.kickoffTime && entry.kickoffTime.getTime() < fixtureTime.getTime())
    .sort((left, right) => right.kickoffTime.getTime() - left.kickoffTime.getTime());
}

function resultFor(entry) {
  const { match, side } = entry;
  const score = match.score || {};
  const goalsFor = side === "home" ? score.home : score.away;
  const goalsAgainst = side === "home" ? score.away : score.home;
  if (goalsFor === null || goalsFor === undefined || goalsAgainst === null || goalsAgainst === undefined) {
    return null;
  }

  const outcome = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
  return {
    matchId: match.id || null,
    kickoff: match.kickoff || null,
    opponent: side === "home" ? match.awayTeam : match.homeTeam,
    venue: side,
    goalsFor,
    goalsAgainst,
    outcome,
    isFriendly: isFriendly(match)
  };
}

function summarizeForm(results) {
  if (!results.length) {
    return {
      sampleSize: 0,
      points: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      weightedScore: null,
      results: [],
      dataStatus: "insufficient"
    };
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let weightedPointsSum = 0;
  let weightSum = 0;

  results.forEach((result, index) => {
    if (result.outcome === "W") wins += 1;
    else if (result.outcome === "D") draws += 1;
    else losses += 1;
    goalsFor += result.goalsFor;
    goalsAgainst += result.goalsAgainst;

    const outcomePoints = result.outcome === "W" ? 3 : result.outcome === "D" ? 1 : 0;
    const recencyWeight = RECENCY_WEIGHTS[index] ?? RECENCY_WEIGHTS[RECENCY_WEIGHTS.length - 1];
    const frienldyWeight = result.isFriendly ? 0.6 : 1;
    const weight = recencyWeight * frienldyWeight;
    weightedPointsSum += (outcomePoints / 3) * weight;
    weightSum += weight;
  });

  const weightedScore = weightSum > 0 ? clamp(Math.round((weightedPointsSum / weightSum) * 100), 0, 100) : null;
  const points = wins * 3 + draws;
  const dataStatus = results.length >= 3 ? "sufficient" : "limited";

  return {
    sampleSize: results.length,
    points,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    weightedScore,
    results,
    dataStatus
  };
}

function computeRecentForm(team, fixtureKickoff, matches, limit) {
  const take = Math.max(1, Number(limit) || RECENT_FORM_LIMIT);
  const results = eligiblePriorMatches(team, fixtureKickoff, matches)
    .slice(0, take)
    .map(resultFor)
    .filter(Boolean);
  return summarizeForm(results);
}

function computeHomeForm(team, fixtureKickoff, matches, limit) {
  const take = Math.max(1, Number(limit) || RECENT_FORM_LIMIT);
  const results = eligiblePriorMatches(team, fixtureKickoff, matches)
    .filter((entry) => entry.side === "home")
    .slice(0, take)
    .map(resultFor)
    .filter(Boolean);
  return summarizeForm(results);
}

function computeAwayForm(team, fixtureKickoff, matches, limit) {
  const take = Math.max(1, Number(limit) || RECENT_FORM_LIMIT);
  const results = eligiblePriorMatches(team, fixtureKickoff, matches)
    .filter((entry) => entry.side === "away")
    .slice(0, take)
    .map(resultFor)
    .filter(Boolean);
  return summarizeForm(results);
}

function trendDirection(recentAverage, priorAverage) {
  if (recentAverage === null || priorAverage === null) {
    return "unknown";
  }
  const delta = recentAverage - priorAverage;
  if (Math.abs(delta) < 0.35) return "stable";
  return delta > 0 ? "up" : "down";
}

function goalSeries(team, fixtureKickoff, matches, side) {
  return eligiblePriorMatches(team, fixtureKickoff, matches)
    .slice(0, RECENT_FORM_LIMIT)
    .map(resultFor)
    .filter(Boolean)
    .map((result) => (side === "for" ? result.goalsFor : result.goalsAgainst));
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeGoalTrend(team, fixtureKickoff, matches) {
  const goals = goalSeries(team, fixtureKickoff, matches, "for");
  if (!goals.length) {
    return { averageGoalsFor: null, direction: "unknown", sampleSize: 0, score: null };
  }

  const recentAverage = average(goals.slice(0, 3));
  const priorAverage = average(goals.slice(3));
  const overallAverage = average(goals);

  return {
    averageGoalsFor: Number(overallAverage.toFixed(2)),
    direction: trendDirection(recentAverage, priorAverage),
    sampleSize: goals.length,
    score: clamp(Math.round((overallAverage / 2.5) * 100), 0, 100)
  };
}

function computeDefensiveTrend(team, fixtureKickoff, matches) {
  const conceded = goalSeries(team, fixtureKickoff, matches, "against");
  if (!conceded.length) {
    return { averageGoalsAgainst: null, direction: "unknown", sampleSize: 0, score: null };
  }

  const recentAverage = average(conceded.slice(0, 3));
  const priorAverage = average(conceded.slice(3));
  const overallAverage = average(conceded);
  // Fewer goals conceded is a better defensive trend, so an "up" swing in
  // goals conceded is reported as "down" for the defensive reading.
  const goalDirection = trendDirection(recentAverage, priorAverage);
  const defensiveDirection = goalDirection === "up" ? "down" : goalDirection === "down" ? "up" : goalDirection;

  return {
    averageGoalsAgainst: Number(overallAverage.toFixed(2)),
    direction: defensiveDirection,
    sampleSize: conceded.length,
    score: clamp(Math.round(100 - (overallAverage / 2.5) * 100), 0, 100)
  };
}

function computeRestDays(team, fixtureKickoff, matches) {
  const prior = eligiblePriorMatches(team, fixtureKickoff, matches)[0];
  if (!prior) {
    return null;
  }

  const fixtureTime = new Date(fixtureKickoff).getTime();
  const diffMs = fixtureTime - prior.kickoffTime.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function computeScheduleLoad(team, fixtureKickoff, matches) {
  const key = teamKey(team);
  const fixtureTime = new Date(fixtureKickoff).getTime();
  if (!key || Number.isNaN(fixtureTime)) {
    return { matchesInWindow: 0, windowDays: SCHEDULE_LOAD_WINDOW_DAYS, level: "unknown" };
  }

  const windowStart = fixtureTime - SCHEDULE_LOAD_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const matchesInWindow = eligiblePriorMatches(team, fixtureKickoff, matches)
    .filter((entry) => entry.kickoffTime.getTime() >= windowStart).length;

  const level = matchesInWindow >= 5 ? "high" : matchesInWindow >= 3 ? "medium" : "low";
  return { matchesInWindow, windowDays: SCHEDULE_LOAD_WINDOW_DAYS, level };
}

function componentConfidence(form, goalTrend, defensiveTrend, restDays) {
  const parts = [];
  if (form.sampleSize > 0) {
    parts.push(clamp((form.sampleSize / RECENT_FORM_LIMIT) * 100, 0, 100));
  }
  if (goalTrend.sampleSize > 0) {
    parts.push(clamp((goalTrend.sampleSize / RECENT_FORM_LIMIT) * 100, 0, 100));
  }
  if (defensiveTrend.sampleSize > 0) {
    parts.push(clamp((defensiveTrend.sampleSize / RECENT_FORM_LIMIT) * 100, 0, 100));
  }
  if (restDays !== null) {
    parts.push(80);
  }

  if (!parts.length) {
    return 0;
  }

  return Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length);
}

function computeContextConfidence(context) {
  if (!context) {
    return 0;
  }

  if (context.home && context.away) {
    const homeConfidence = Number(context.home.confidence) || 0;
    const awayConfidence = Number(context.away.confidence) || 0;
    return Math.round((homeConfidence + awayConfidence) / 2);
  }

  const form = context.recentForm || { sampleSize: 0 };
  const goalTrend = context.goalTrend || { sampleSize: 0 };
  const defensiveTrend = context.defensiveTrend || { sampleSize: 0 };
  return componentConfidence(form, goalTrend, defensiveTrend, context.restDays ?? null);
}

function buildTeamContext(team, fixtureKickoff, historicalMatches) {
  const recentForm = computeRecentForm(team, fixtureKickoff, historicalMatches, RECENT_FORM_LIMIT);
  const homeForm = computeHomeForm(team, fixtureKickoff, historicalMatches, RECENT_FORM_LIMIT);
  const awayForm = computeAwayForm(team, fixtureKickoff, historicalMatches, RECENT_FORM_LIMIT);
  const goalTrend = computeGoalTrend(team, fixtureKickoff, historicalMatches);
  const defensiveTrend = computeDefensiveTrend(team, fixtureKickoff, historicalMatches);
  const restDays = computeRestDays(team, fixtureKickoff, historicalMatches);
  const scheduleLoad = computeScheduleLoad(team, fixtureKickoff, historicalMatches);
  const warnings = [];

  if (recentForm.sampleSize === 0) {
    warnings.push("no-prior-verified-matches");
  } else if (recentForm.sampleSize < 3) {
    warnings.push("limited-recent-match-sample");
  }
  if (recentForm.results.every((result) => result.isFriendly) && recentForm.results.length > 0) {
    warnings.push("recent-form-is-friendlies-only");
  }

  const confidence = componentConfidence(recentForm, goalTrend, defensiveTrend, restDays);

  return {
    teamName: typeof team === "string" ? team : team && (team.name || team.team) || null,
    recentForm,
    homeForm,
    awayForm,
    goalTrend,
    defensiveTrend,
    restDays,
    scheduleLoad,
    confidence,
    dataStatus: confidence >= 60 ? "sufficient" : confidence >= 25 ? "limited" : "insufficient",
    warnings
  };
}

function buildMatchContext(fixture, homeTeam, awayTeam, historicalMatches) {
  const fixtureKickoff = fixture && (fixture.kickoff || fixture.date);
  const home = buildTeamContext(homeTeam || (fixture && fixture.homeTeam), fixtureKickoff, historicalMatches);
  const away = buildTeamContext(awayTeam || (fixture && fixture.awayTeam), fixtureKickoff, historicalMatches);
  const confidence = computeContextConfidence({ home, away });
  const warnings = [...home.warnings.map((w) => `home:${w}`), ...away.warnings.map((w) => `away:${w}`)];

  return {
    fixtureId: fixture && (fixture.id || fixture.fixtureId) || null,
    generatedAt: new Date().toISOString(),
    home,
    away,
    confidence,
    warnings
  };
}

module.exports = {
  buildMatchContext,
  computeRecentForm,
  computeHomeForm,
  computeAwayForm,
  computeGoalTrend,
  computeDefensiveTrend,
  computeRestDays,
  computeScheduleLoad,
  computeContextConfidence,
  RECENT_FORM_LIMIT
};
