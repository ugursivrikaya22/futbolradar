function slug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function severity(score) {
  const value = Number(score || 0);
  if (value >= 78) {
    return "high";
  }
  if (value >= 62) {
    return "medium";
  }
  return "low";
}

function signal(type, title, summary, options) {
  const opts = options || {};
  return {
    id: opts.id || `${type}-${slug(title)}`,
    group: opts.group || "radarSignals",
    type,
    label: opts.label || title,
    title,
    summary,
    description: summary,
    severity: opts.severity || severity(opts.score),
    relatedTeam: opts.relatedTeam || null,
    relatedMatchId: opts.relatedMatchId || null,
    value: opts.value == null ? opts.score : opts.value,
    score: opts.score == null ? null : opts.score,
    source: "computed"
  };
}

function detectFormRise(momentum) {
  const item = (momentum || []).find((row) => row.trend === "up") || (momentum || [])[0];
  if (!item) {
    return null;
  }

  return signal(
    "form-rise",
    "Formu yukselen takim",
    `${item.team} son maclarda momentumunu artirdi.`,
    { relatedTeam: item.team, score: item.momentum, value: item.momentum, label: item.team }
  );
}

function detectMomentumDrop(momentum) {
  const item = (momentum || []).slice().reverse().find((row) => row.trend === "down") || (momentum || []).slice().sort((a, b) => Number(a.momentum) - Number(b.momentum))[0];
  if (!item) {
    return null;
  }

  return signal(
    "momentum-drop",
    "Momentum dususu",
    `${item.team} icin form ve savunma dengesi izlenmeli.`,
    { relatedTeam: item.team, score: 100 - Number(item.momentum || 0), value: item.momentum, severity: "medium" }
  );
}

function detectGoalPotential(matches) {
  const match = (matches || []).slice().sort((a, b) => {
    return Number(b.homeMomentum || b.homeForm || 0) + Number(b.awayMomentum || b.awayForm || 0) -
      (Number(a.homeMomentum || a.homeForm || 0) + Number(a.awayMomentum || a.awayForm || 0));
  })[0];
  if (!match) {
    return null;
  }

  const score = Math.round((Number(match.homeMomentum || match.homeForm || 0) + Number(match.awayMomentum || match.awayForm || 0)) / 2);
  return signal(
    "goal-potential",
    `${match.homeTeam} - ${match.awayTeam}`,
    "Iki takimin hucum ve momentum ortalamasi gol potansiyelini yukari tasiyor.",
    { relatedMatchId: match.id, score, value: match.goalExpectation || match.goalPotential || score, severity: severity(score) }
  );
}

function detectUpsetRisk(matches, standings, momentum) {
  const rankByTeam = new Map((standings || []).map((team) => [team.name || team.team, Number(team.rank || 99)]));
  const momentumByTeam = new Map((momentum || []).map((team) => [team.team, Number(team.momentum || 0)]));
  const candidate = (matches || []).find((match) => {
    const homeRank = rankByTeam.get(match.homeTeam) || 99;
    const awayRank = rankByTeam.get(match.awayTeam) || 99;
    const homeMomentum = momentumByTeam.get(match.homeTeam) || Number(match.homeMomentum || 0);
    const awayMomentum = momentumByTeam.get(match.awayTeam) || Number(match.awayMomentum || 0);
    return awayRank > homeRank && awayMomentum + 5 >= homeMomentum;
  });

  if (!candidate) {
    return null;
  }

  return signal(
    "upset-risk",
    "Surpriz riski",
    `${candidate.awayTeam} deplasman momentumu mac dengesini bozabilir.`,
    { relatedMatchId: candidate.id, score: 68, value: "%42", severity: "medium" }
  );
}

function detectBalancedMatches(matches) {
  const match = (matches || []).find((item) => {
    return Math.abs(Number(item.homeMomentum || item.homeForm || 0) - Number(item.awayMomentum || item.awayForm || 0)) <= 6;
  });

  if (!match) {
    return null;
  }

  return signal(
    "balanced-match",
    "Dengeli mac",
    `${match.homeTeam} - ${match.awayTeam} momentum farki dusuk bir eslesme.`,
    { relatedMatchId: match.id, score: 61, value: "Dengeli", severity: "low" }
  );
}

function generateSignals(payload) {
  const matches = payload && payload.matches || [];
  const standings = payload && payload.standings || [];
  const momentum = payload && payload.momentum || [];
  const radarSignals = [
    detectFormRise(momentum),
    detectGoalPotential(matches),
    detectUpsetRisk(matches, standings, momentum),
    detectBalancedMatches(matches),
    detectMomentumDrop(momentum)
  ].filter(Boolean).slice(0, 5);
  const momentumSignals = momentum.slice(0, 3).map((item) => signal(
    item.trend === "down" ? "momentum-drop" : "form-rise",
    item.team,
    item.explanation || `${item.team} momentum skoru ${item.momentum}.`,
    { group: "momentumSignals", relatedTeam: item.team, score: item.momentum, value: item.momentum, severity: severity(item.momentum) }
  ));

  return [...radarSignals, ...momentumSignals];
}

module.exports = {
  detectBalancedMatches,
  detectFormRise,
  detectGoalPotential,
  detectMomentumDrop,
  detectUpsetRisk,
  generateSignals
};
