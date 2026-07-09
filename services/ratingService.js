const { normalizeText } = require("./playerService");

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, number));
}

function score(value, max) {
  return clamp((Number(value) / Number(max || 1)) * 100, 0, 100);
}

function positionGroup(position) {
  const normalized = normalizeText(position);
  if (normalized.includes("kaleci")) {
    return "goalkeeper";
  }
  if (normalized.includes("stoper") || normalized.includes("defans") || normalized.includes("bek")) {
    return "defender";
  }
  if (normalized.includes("orta") || normalized.includes("10 numara") || normalized.includes("merkez")) {
    return "midfielder";
  }
  return "forward";
}

function ageDevelopmentScore(player) {
  const age = Number(player.computedAge || player.age);
  if (!Number.isFinite(age)) {
    return 55;
  }
  if (age <= 21) {
    return 92;
  }
  if (age <= 24) {
    return 86;
  }
  if (age <= 29) {
    return 76;
  }
  if (age <= 33) {
    return 63;
  }
  return 48;
}

function formScore(player) {
  const formRating = Number(player.formRating || player.impact || player.overallRating || player.aiRating);
  if (Number.isFinite(formRating) && formRating > 0) {
    return clamp(formRating, 0, 100);
  }

  const form = Array.isArray(player.form) ? player.form : [];
  const values = form
    .map((item) => Number(item.label))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return 55;
  }

  return clamp((values.reduce((sum, value) => sum + value, 0) / values.length) * 10, 0, 100);
}

function disciplineScore(player) {
  const yellow = Number(player.yellowCards || 0);
  const red = Number(player.redCards || 0);
  return clamp(100 - yellow * 4 - red * 18, 0, 100);
}

function reliabilityScore(player) {
  const status = normalizeText(player.dataStatus);
  if (status.includes("verified") || status.includes("manual")) {
    return 100;
  }
  if (status.includes("provider")) {
    return 88;
  }
  if (status.includes("estimated")) {
    return 72;
  }
  if (status.includes("stale") || status.includes("monitoring")) {
    return 62;
  }
  return 70;
}

function componentScores(player, context) {
  const minutes = score(player.minutesPlayed || player.minutes, 900);
  const goals = score(player.goals, 12);
  const assists = score(player.assists, 10);
  const cards = disciplineScore(player);
  const age = ageDevelopmentScore(player);
  const form = formScore(player);
  const teamDefense = score(context && context.teamDefense || player.defensiveRating || 55, 100);
  const cleanSheet = score(player.cleanSheets || player.cleanSheet || 0, 10);
  const reliability = reliabilityScore(player);

  return { minutes, goals, assists, cards, age, form, teamDefense, cleanSheet, reliability };
}

function weighted(parts, weights) {
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  const total = Object.keys(weights).reduce((sum, key) => sum + (Number(parts[key] || 0) * weights[key]), 0);
  return total / totalWeight;
}

function computePlayerRating(player, context) {
  const existing = Number(player.overallRating || player.aiRating || player.rating);
  const protectedRating = normalizeText(player.ratingStatus).includes("manual");
  if (protectedRating && Number.isFinite(existing)) {
    return {
      aiRating: clamp(Math.round(existing), 0, 100),
      ratingStatus: player.ratingStatus,
      ratingExplanation: "Bu oyuncuda manuel rating korunur; provider verisi otomatik ezmez."
    };
  }

  const group = positionGroup(player.position);
  const parts = componentScores(player, context || {});
  const weightsByPosition = {
    forward: { goals: 35, assists: 15, minutes: 15, form: 20, cards: 5, age: 10 },
    midfielder: { assists: 25, minutes: 20, goals: 15, form: 20, cards: 5, age: 15 },
    defender: { minutes: 25, teamDefense: 25, goals: 5, assists: 5, form: 20, cards: 10, age: 10 },
    goalkeeper: { minutes: 25, teamDefense: 25, cleanSheet: 25, form: 15, cards: 5, age: 5 }
  };
  const raw = weighted(parts, weightsByPosition[group]) * 0.9 + parts.reliability * 0.1;
  const fallback = Number.isFinite(existing) ? existing : raw;

  return {
    aiRating: clamp(Math.round((raw + fallback) / 2), 0, 100),
    ratingStatus: player.ratingStatus === "provider" ? "provider" : "estimated",
    ratingExplanation: "Bu rating; dakika, gol/asist, form, disiplin ve veri guvenilirligi bilesenlerinden hesaplanir.",
    ratingComponents: parts,
    positionGroup: group
  };
}

function enrichPlayerRating(player, context) {
  const result = computePlayerRating(player, context);
  return {
    ...player,
    aiRating: result.aiRating,
    rating: player.rating || result.aiRating,
    overallRating: player.overallRating || result.aiRating,
    ratingStatus: result.ratingStatus,
    ratingExplanation: result.ratingExplanation,
    ratingComponents: result.ratingComponents,
    positionGroup: result.positionGroup
  };
}

module.exports = {
  computePlayerRating,
  enrichPlayerRating,
  positionGroup
};
