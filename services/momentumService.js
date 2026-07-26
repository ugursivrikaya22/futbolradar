function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, number));
}

function normalizeFormResult(result) {
  const value = String(result && (result.result || result.label || result) || "").toLowerCase();
  if (["w", "win", "g", "galibiyet"].includes(value)) {
    return "W";
  }
  if (["d", "draw", "b", "beraberlik"].includes(value)) {
    return "D";
  }
  if (["l", "loss", "m", "maglubiyet", "mağlubiyet"].includes(value)) {
    return "L";
  }
  return "D";
}

function formPoints(form) {
  return form.reduce((sum, result) => {
    if (result === "W") {
      return sum + 3;
    }
    if (result === "D") {
      return sum + 1;
    }
    return sum;
  }, 0);
}

function numericAverage(value) {
  if (typeof value === "number") {
    return value;
  }

  const number = Number(String(value || "").replace("+", ""));
  return Number.isFinite(number) ? number : 0;
}

function inferTrend(form) {
  const early = form.slice(0, 2);
  const recent = form.slice(-2);
  const earlyPoints = formPoints(early);
  const recentPoints = formPoints(recent);
  if (recentPoints > earlyPoints) {
    return "up";
  }
  if (recentPoints < earlyPoints) {
    return "down";
  }
  return "stable";
}

function buildMomentumExplanation(momentum) {
  return `Son 5 macta ${momentum.formPoints} puan, hucum skoru ${momentum.attackScore} ve savunma skoru ${momentum.defenseScore}.`;
}

function teamMatchImpact(teamName, matches) {
  const related = (Array.isArray(matches) ? matches : []).filter((match) => {
    return match.homeTeam === teamName || match.awayTeam === teamName;
  });

  if (!related.length) {
    return { attack: null, defense: null, modifier: 0 };
  }

  const attack = related.reduce((sum, match) => {
    const isHome = match.homeTeam === teamName;
    return sum + Number(isHome ? match.homeMomentum || match.homeForm || 0 : match.awayMomentum || match.awayForm || 0);
  }, 0) / related.length;
  const defense = related.reduce((sum, match) => {
    const isHome = match.homeTeam === teamName;
    return sum + Number(isHome ? match.awayMomentum || match.awayForm || 0 : match.homeMomentum || match.homeForm || 0);
  }, 0) / related.length;
  const homeCount = related.filter((match) => match.homeTeam === teamName).length;

  return {
    attack: clamp(Math.round(attack), 0, 100),
    defense: clamp(Math.round(100 - defense / 2), 0, 100),
    modifier: homeCount ? 6 : 0
  };
}

/**
 * Momentum hesaplanabilir mi?
 *
 * Hesap, eksik alanları varsayılanlarla dolduruyor: form yoksa beş beraberlik
 * ("D") uyduruluyor, hücum/savunma yoksa 55 kabul ediliyor. Bu varsayılanlar
 * ölçümü olan takımlarda küçük bir yumuşatmayken, HİÇ verisi olmayan bir
 * takımda tamamen üretilmiş bir tablo satırı doğuruyordu: lige yeni eklenen
 * takımlar "5 beraberlik, hücum 55, momentum 39, risk yüksek" ile sıralamaya
 * giriyor ve bu /api/momentum ile ok:true olarak yayımlanıyordu.
 *
 * Ölçülmüş hiçbir girdi yoksa momentum üretilmez; takım tablodan çıkarılır.
 */
function hasMomentumInputs(team) {
  if (!team) return false;
  const form = Array.isArray(team.form) ? team.form.filter(Boolean) : [];
  if (form.length) return true;

  const numeric = [team.attack, team.attackRating, team.defense, team.defenseRating, team.momentum, team.formScore];
  return numeric.some((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)));
}

function computeTeamMomentum(team, matches, standings) {
  const form = (Array.isArray(team.form) ? team.form : []).map(normalizeFormResult).slice(-5);
  while (form.length < 5) {
    form.unshift("D");
  }

  const points = formPoints(form);
  const standing = (Array.isArray(standings) ? standings : []).find((item) => {
    return (item.team || item.name) === team.name;
  }) || team;
  const matchImpact = teamMatchImpact(team.name || team.team, matches);
  const goalDiff = numericAverage(standing.goalDifference || standing.average);
  const formScore = clamp(Math.round((points / 15) * 40), 0, 40);
  const goalTrendScore = clamp(Math.round((goalDiff + 15) / 30 * 20), 0, 20);
  const attackScore = clamp(Math.round(matchImpact.attack == null ? team.attack || team.attackRating || 55 : matchImpact.attack), 0, 100);
  const defenseScore = clamp(Math.round(matchImpact.defense == null ? team.defense || team.defenseRating || 55 : matchImpact.defense), 0, 100);
  const attackWeighted = Math.round((attackScore / 100) * 15);
  const defenseWeighted = Math.round((defenseScore / 100) * 15);
  const homeAwayModifier = matchImpact.modifier;
  const momentum = clamp(formScore + goalTrendScore + attackWeighted + defenseWeighted + homeAwayModifier, 0, 100);
  const result = {
    id: team.id || team.name,
    rank: team.rank,
    team: team.name || team.team,
    momentum,
    score: momentum,
    trend: inferTrend(form),
    form,
    formScore: Number(((points / 15) * 10).toFixed(1)),
    formPoints: points,
    attackScore,
    defenseScore,
    goalSignal: attackScore >= 76 ? "Yuksek" : attackScore >= 62 ? "Orta" : "Dusuk",
    risk: defenseScore < 60 ? "Yuksek" : defenseScore < 72 ? "Orta" : "Dusuk",
    homeAwayModifier,
    source: "computed"
  };

  return {
    ...result,
    explanation: buildMomentumExplanation(result)
  };
}

function computeLeagueMomentum(teams, matches, standings) {
  // Ölçümü olmayan takım momentum tablosuna girmez: uydurulmuş bir satır,
  // boş bir satırdan daha yanıltıcıdır.
  return (Array.isArray(teams) ? teams : [])
    .filter(hasMomentumInputs)
    .map((team) => computeTeamMomentum(team, matches, standings))
    .sort((a, b) => Number(b.momentum || 0) - Number(a.momentum || 0))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

module.exports = {
  buildMomentumExplanation,
  computeLeagueMomentum,
  hasMomentumInputs,
  computeTeamMomentum,
  normalizeFormResult
};
