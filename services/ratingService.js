function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
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

function average(values, fallback) {
  const safe = values.map(Number).filter((value) => Number.isFinite(value));
  if (!safe.length) {
    return fallback;
  }

  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
}

function score(value, max) {
  return clamp((Number(value) / Number(max || 1)) * 100, 0, 100);
}

function numberFrom(player, keys, fallback) {
  const key = keys.find((item) => Number.isFinite(Number(player[item])));
  return key ? Number(player[key]) : fallback;
}

function statValue(player, key, fallback) {
  if (player.stats && Number.isFinite(Number(player.stats[key]))) {
    return Number(player.stats[key]);
  }

  return numberFrom(player, [key], fallback);
}

function positionGroup(position) {
  const normalized = normalizeText(position);
  if (normalized.includes("kaleci") || normalized.includes("goalkeeper")) {
    return "goalkeeper";
  }
  if (
    normalized.includes("stoper") ||
    normalized.includes("defans") ||
    normalized.includes("bek") ||
    normalized.includes("sag bek") ||
    normalized.includes("sol bek") ||
    normalized.includes("centre back") ||
    normalized.includes("full back")
  ) {
    return "defender";
  }
  if (
    normalized.includes("kanat") ||
    normalized.includes("wing") ||
    normalized.includes("sol acik") ||
    normalized.includes("sag acik")
  ) {
    return "winger";
  }
  if (
    normalized.includes("orta") ||
    normalized.includes("10 numara") ||
    normalized.includes("merkez") ||
    normalized.includes("midfield")
  ) {
    return "midfielder";
  }

  return "forward";
}

function ageDevelopmentScore(player) {
  const age = Number(player.computedAge || player.age);
  if (!Number.isFinite(age)) {
    return 58;
  }
  if (age <= 19) {
    return 98;
  }
  if (age <= 21) {
    return 94;
  }
  if (age <= 24) {
    return 88;
  }
  if (age <= 29) {
    return 76;
  }
  if (age <= 33) {
    return 62;
  }
  return 45;
}

function formScore(player) {
  const direct = Number(player.formRating || player.impact || player.overallRating || player.aiRating || player.rating);
  if (Number.isFinite(direct) && direct > 0) {
    return clamp(direct, 0, 100);
  }

  const form = Array.isArray(player.form) ? player.form : [];
  const values = form.map((item) => Number(item.label)).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return 58;
  }

  return clamp(average(values, 5.8) * 10, 0, 100);
}

function disciplineScore(player) {
  const yellow = statValue(player, "yellowCards", 0);
  const red = statValue(player, "redCards", 0);
  const appearances = Math.max(1, statValue(player, "appearances", 12));
  const cardLoad = (yellow / appearances) * 30 + red * 18;
  return clamp(100 - cardLoad, 0, 100);
}

function durabilityScore(player) {
  const minutes = statValue(player, "minutesPlayed", Number(player.minutes || 0));
  const appearances = statValue(player, "appearances", 0);
  const minutesScore = score(minutes, 900);
  const appearanceScore = score(appearances, 20);
  const stamina = Number(player.staminaRating);
  return clamp(average([minutesScore, appearanceScore, Number.isFinite(stamina) ? stamina : null], 62), 0, 100);
}

function dataConfidenceScore(player) {
  const status = normalizeText(player.dataStatus);
  const ratingStatus = normalizeText(player.ratingStatus);

  if (status.includes("verified") || status.includes("manual")) {
    return ratingStatus.includes("manual") || ratingStatus.includes("verified") ? 98 : 92;
  }
  if (status.includes("provider")) {
    return 88;
  }
  if (status.includes("estimated")) {
    return 74;
  }
  if (status.includes("stale") || status.includes("monitoring")) {
    return 62;
  }
  if (status.includes("pending")) {
    return 55;
  }

  return 68;
}

function computePlayerRadar(player, context) {
  const group = positionGroup(player.position);
  const stats = player.stats || {};
  const goals = statValue(player, "goals", 0);
  const assists = statValue(player, "assists", 0);
  const shots = Number(player.shots || stats.shots || 0);
  const keyPasses = Number(player.keyPasses || stats.keyPasses || 0);
  const xg = Number(player.xg || stats.xg || 0);
  const xa = Number(player.xa || stats.xa || 0);
  const tackles = Number(player.tacklesPerGame || stats.tacklesPerGame || 0);
  const interceptions = Number(player.interceptionsPerGame || stats.interceptionsPerGame || 0);
  const cleanSheets = Number(player.cleanSheets || stats.cleanSheets || 0);
  const goalsConceded = Number(player.goalsConceded || stats.goalsConceded || 0);
  const existingRadar = player.radar && typeof player.radar === "object" ? player.radar : {};

  const attack = clamp(average([
    Number(player.attackingRating),
    Number(player.shootingRating),
    Number(player.threatScore),
    existingRadar.attack,
    existingRadar.finishing,
    score(goals, group === "forward" || group === "winger" ? 10 : 6),
    score(shots, 22),
    score(xg, 6)
  ], group === "goalkeeper" ? 18 : 58), 0, 100);

  const creativity = clamp(average([
    Number(player.creativityScore),
    Number(player.passingRating),
    Number(player.dribblingRating),
    existingRadar.creativity,
    score(assists, 8),
    score(keyPasses, 18),
    score(xa, 4)
  ], 58), 0, 100);

  const defense = clamp(average([
    Number(player.defensiveRating),
    Number(player.pressingScore),
    existingRadar.defense,
    existingRadar.pressing,
    score(tackles, group === "defender" || group === "midfielder" ? 2.6 : 1.4),
    score(interceptions, group === "defender" ? 2.2 : 1.2),
    group === "goalkeeper" ? score(cleanSheets, 10) : null,
    group === "goalkeeper" ? clamp(100 - goalsConceded * 8, 0, 100) : null,
    context && context.teamDefense
  ], group === "forward" || group === "winger" ? 48 : 62), 0, 100);

  const form = formScore(player);
  const durability = durabilityScore(player);
  const discipline = disciplineScore(player);
  const potential = clamp(average([
    Number(player.potentialRating),
    ageDevelopmentScore(player),
    Number(player.formChange) > 0 ? 72 + Number(player.formChange) * 4 : null
  ], 62), 0, 100);
  const transferValue = clamp(average([
    score(player.marketValueEur, 30000000),
    Number(player.potentialRating),
    Number(player.overallRating || player.aiRating || player.rating)
  ], 55), 0, 100);
  const dataConfidence = dataConfidenceScore(player);

  const radar = {
    overall: null,
    form: Math.round(form),
    attack: Math.round(attack),
    creativity: Math.round(creativity),
    defense: Math.round(defense),
    discipline: Math.round(discipline),
    durability: Math.round(durability),
    potential: Math.round(potential),
    transferValue: Math.round(transferValue),
    dataConfidence: Math.round(dataConfidence)
  };

  radar.overall = computeOverallRating(radar, group, player);
  return radar;
}

const POSITION_WEIGHTS = {
  forward: { attack: 35, form: 20, creativity: 15, durability: 10, discipline: 5, potential: 10, dataConfidence: 5 },
  winger: { attack: 25, creativity: 25, form: 20, durability: 10, discipline: 5, potential: 10, dataConfidence: 5 },
  midfielder: { creativity: 30, form: 20, defense: 15, durability: 15, attack: 10, discipline: 5, dataConfidence: 5 },
  defender: { defense: 35, durability: 20, form: 15, discipline: 10, attack: 5, potential: 10, dataConfidence: 5 },
  goalkeeper: { defense: 40, durability: 20, form: 15, discipline: 5, potential: 10, dataConfidence: 10 }
};

function weighted(parts, weights) {
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.keys(weights).reduce((sum, key) => sum + Number(parts[key] || 0) * weights[key], 0) / totalWeight;
}

function computeOverallRating(playerRadar, group, player) {
  const weights = POSITION_WEIGHTS[group] || POSITION_WEIGHTS.forward;
  const existing = Number(player && (player.overallRating || player.aiRating || player.rating));
  const manualRating = player && normalizeText(player.ratingStatus).includes("manual");
  const computed = weighted(playerRadar || {}, weights);

  if (manualRating && Number.isFinite(existing)) {
    return clamp(Math.round(existing), 0, 100);
  }

  if (Number.isFinite(existing) && existing > 0) {
    return clamp(Math.round(computed * 0.62 + existing * 0.38), 0, 100);
  }

  return clamp(Math.round(computed), 0, 100);
}

const STRENGTH_LABELS = [
  ["attack", "Hucum tehdidi"],
  ["creativity", "Yaraticilik"],
  ["defense", "Savunma katkisi"],
  ["form", "Form ivmesi"],
  ["durability", "Sureklilik"],
  ["potential", "Gelisim potansiyeli"],
  ["discipline", "Disiplin"],
  ["dataConfidence", "Veri guveni"]
];

function deriveStrengths(player, radar) {
  if (Array.isArray(player.strengths) && player.strengths.length) {
    return player.strengths;
  }

  return STRENGTH_LABELS
    .map(([key, label]) => ({ key, label, value: Number(radar[key] || 0) }))
    .filter((item) => item.value >= 72)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4)
    .map((item) => item.label);
}

function deriveWeaknesses(player, radar) {
  if (Array.isArray(player.weaknesses) && player.weaknesses.length) {
    return player.weaknesses;
  }

  return STRENGTH_LABELS
    .map(([key, label]) => ({ key, label, value: Number(radar[key] || 0) }))
    .filter((item) => item.value > 0 && item.value < 58)
    .sort((a, b) => a.value - b.value)
    .slice(0, 3)
    .map((item) => item.label + " gelistirilmeli");
}

function computePlayerRating(player, context) {
  const group = positionGroup(player.position);
  const radar = computePlayerRadar(player, context || {});
  const aiRating = computeOverallRating(radar, group, player);
  const manualRating = normalizeText(player.ratingStatus).includes("manual");

  return {
    aiRating,
    overallRating: aiRating,
    ratingStatus: manualRating ? player.ratingStatus : (player.ratingStatus === "provider" ? "provider" : "estimated"),
    ratingExplanation: "Bu rating; pozisyona gore agirliklanan hucum, yaraticilik, savunma, form, sureklilik, potansiyel ve veri guveni skorlarindan hesaplanir.",
    ratingComponents: radar,
    radar,
    positionGroup: group,
    strengths: deriveStrengths(player, radar),
    weaknesses: deriveWeaknesses(player, radar)
  };
}

function enrichPlayerRating(player, context) {
  const result = computePlayerRating(player, context);
  const manualRating = normalizeText(player.ratingStatus).includes("manual");
  const protectedValue = Number(player.overallRating || player.aiRating || player.rating);
  const rating = manualRating && Number.isFinite(protectedValue) ? clamp(Math.round(protectedValue), 0, 100) : result.aiRating;

  return {
    ...player,
    aiRating: rating,
    rating: player.rating || rating,
    overallRating: rating,
    ratingStatus: result.ratingStatus,
    ratingExplanation: result.ratingExplanation,
    ratingComponents: result.ratingComponents,
    radar: { ...(player.radar || {}), ...result.radar, overall: rating },
    positionGroup: result.positionGroup,
    strengths: result.strengths,
    weaknesses: result.weaknesses
  };
}

module.exports = {
  computeOverallRating,
  computePlayerRadar,
  computePlayerRating,
  deriveStrengths,
  deriveWeaknesses,
  enrichPlayerRating,
  inferPositionGroup: positionGroup,
  positionGroup
};
