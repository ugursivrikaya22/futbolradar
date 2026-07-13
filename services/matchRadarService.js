const { normalizeConfidence } = require("./freshnessService");

const RADAR_WEIGHTS = Object.freeze({
  form: 25,
  attack: 20,
  defense: 15,
  venue: 15,
  availability: 15,
  keyPlayer: 10
});

const COMPONENT_LABELS = Object.freeze({
  form: "Son 5 maç formu",
  attack: "Hücum eğilimi",
  defense: "Savunma güveni",
  venue: "İç saha / deplasman performansı",
  availability: "Kadro devamlılığı",
  keyPlayer: "Kilit oyuncu formu"
});

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.max(min, Math.min(max, number));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

function numeric(value, max) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clamp(max && parsed <= max ? (parsed / max) * 100 : parsed, 0, 100);
}

function average(values) {
  const safe = values.map(Number).filter(Number.isFinite);
  if (!safe.length) {
    return null;
  }

  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
}

function formScore(team) {
  if (team && team.formScore !== undefined && team.formScore !== null) {
    return numeric(team.formScore, Number(team.formScore) <= 10 ? 10 : null);
  }

  const form = Array.isArray(team && team.form) ? team.form : [];
  const points = form.map((item) => {
    const label = normalizeText(item && (item.label || item.result || item));
    if (label === "g" || label === "win" || label === "galibiyet") return 100;
    if (label === "b" || label === "draw" || label === "beraberlik") return 50;
    if (label === "m" || label === "loss" || label === "maglubiyet") return 0;
    return null;
  }).filter((value) => value !== null);

  return average(points);
}

function playerSignal(players, teamName) {
  const wanted = normalizeText(teamName);
  const teamPlayers = (Array.isArray(players) ? players : [])
    .filter((player) => normalizeText(player.currentTeam || player.team) === wanted)
    .map((player) => {
      const radar = player && typeof player.radar === "object" ? player.radar : {};
      return numeric(player.formRating ?? radar.form ?? player.overallRating ?? player.aiRating ?? player.rating);
    })
    .filter((value) => value !== null)
    .sort((left, right) => right - left)
    .slice(0, 3);

  return average(teamPlayers);
}

function squadSignal(squadStatus, teamName) {
  const rows = Array.isArray(squadStatus && squadStatus.teams) ? squadStatus.teams : [];
  const row = rows.find((item) => normalizeText(item.team || item.name) === normalizeText(teamName));
  if (!row) {
    return null;
  }

  if (row.totalAbsenceImpact !== undefined) {
    return clamp(100 - Number(row.totalAbsenceImpact), 0, 100);
  }

  if (row.absenceImpact !== undefined) {
    return clamp(100 - Number(row.absenceImpact), 0, 100);
  }

  if (row.available !== undefined) {
    return clamp(Number(row.available), 0, 100);
  }

  return null;
}

function venueScore(team, side) {
  if (!team) {
    return null;
  }

  const fields = side === "home"
    ? ["homePerformance", "homeFormScore", "homeRating"]
    : ["awayPerformance", "awayFormScore", "awayRating"];
  const value = fields.map((field) => team[field]).find((item) => item !== undefined && item !== null && item !== "");
  return value === undefined ? null : numeric(value, Number(value) <= 10 ? 10 : null);
}

function teamComponents(team, side, players, squadStatus) {
  const attack = numeric(team && (team.attack ?? team.attackRating));
  const defense = numeric(team && (team.defense ?? team.defenseRating));
  return {
    form: formScore(team),
    attack,
    defense,
    venue: venueScore(team, side),
    availability: squadSignal(squadStatus, team && team.name),
    keyPlayer: playerSignal(players, team && team.name)
  };
}

function confidenceFromCoverage(coverage) {
  if (coverage >= 0.85) return "high";
  if (coverage >= 0.5) return "medium";
  return "low";
}

function formatFactor(component) {
  return `${COMPONENT_LABELS[component.key]} ${Math.round(component.value)}/100`;
}

function calculateTeamRadar(team, options) {
  const opts = options || {};
  const componentsByKey = teamComponents(team, opts.side || "home", opts.players, opts.squadStatus);
  const components = Object.entries(RADAR_WEIGHTS).map(([key, weight]) => ({
    key,
    label: COMPONENT_LABELS[key],
    weight,
    value: componentsByKey[key]
  }));
  const known = components.filter((component) => component.value !== null);
  const totalWeight = known.reduce((sum, component) => sum + component.weight, 0);
  const score = totalWeight
    ? Math.round(known.reduce((sum, component) => sum + component.value * component.weight, 0) / totalWeight)
    : null;
  const coverage = totalWeight / 100;
  const positives = known
    .filter((component) => component.value >= 50)
    .sort((left, right) => (right.value - 50) - (left.value - 50))
    .slice(0, 3)
    .map(formatFactor);
  const negatives = known
    .filter((component) => component.value < 50)
    .sort((left, right) => left.value - right.value)
    .slice(0, 3)
    .map(formatFactor);
  const missing = components.filter((component) => component.value === null).map((component) => component.label);

  return {
    score,
    confidence: normalizeConfidence(opts.confidence || confidenceFromCoverage(coverage)),
    coverage: Math.round(coverage * 100),
    components,
    positives,
    negatives,
    missing,
    explanation: {
      positive: positives,
      negative: negatives,
      missing
    }
  };
}

function findTeam(teams, name) {
  return (Array.isArray(teams) ? teams : []).find((team) => normalizeText(team.name || team.team) === normalizeText(name)) || null;
}

function calculateMatchRadar(match, context) {
  const source = match || {};
  const options = context || {};
  const homeTeam = findTeam(options.teams, source.homeTeam);
  const awayTeam = findTeam(options.teams, source.awayTeam);
  const home = calculateTeamRadar(homeTeam, {
    side: "home",
    players: options.players,
    squadStatus: options.squadStatus,
    confidence: options.confidence
  });
  const away = calculateTeamRadar(awayTeam, {
    side: "away",
    players: options.players,
    squadStatus: options.squadStatus,
    confidence: options.confidence
  });
  const availableScores = [home.score, away.score].filter((value) => value !== null);
  const balance = availableScores.length === 2 ? Math.abs(home.score - away.score) : null;

  return {
    fixtureId: source.providerId || source.id || null,
    homeTeam: source.homeTeam || "Ev sahibi",
    awayTeam: source.awayTeam || "Deplasman",
    home,
    away,
    balance,
    lead: balance === null
      ? "İki takımın ortak radar verisi henüz tamamlanmadı. Eldeki bileşenler ayrı ayrı gösteriliyor."
      : balance <= 4
        ? "Radar puanları birbirine yakın; maç öncesi denge yüksek görünüyor."
        : `${home.score > away.score ? source.homeTeam : source.awayTeam} mevcut radar bileşenlerinde önde görünüyor.`,
    disclaimer: "Radar puanı maç öncesi okuma içindir; kesin sonuç veya bahis önerisi değildir."
  };
}

module.exports = {
  COMPONENT_LABELS,
  RADAR_WEIGHTS,
  calculateMatchRadar,
  calculateTeamRadar,
  confidenceFromCoverage,
  findTeam,
  normalizeText
};
