const COMPONENT_WEIGHTS = Object.freeze({
  homeAttackVsAwayDefense: 16,
  awayAttackVsHomeDefense: 16,
  midfield: 14,
  wideAreas: 10,
  goalkeepers: 10,
  bench: 10,
  form: 14,
  availability: 10
});

const KEY_DUEL_TEMPLATES = [
  { id: "forward-vs-defense", title: "Santrfor - stoper eşleşmesi", homeSlot: "FWD", awaySlot: "DEF" },
  { id: "wide-vs-fullback", title: "Kanat - bek eşleşmesi", homeSlot: "WING", awaySlot: "DEF" },
  { id: "away-forward-vs-defense", title: "Deplasman santrforu - ev savunması", homeSlot: "DEF", awaySlot: "FWD" },
  { id: "midfield-battle", title: "Orta saha mücadelesi", homeSlot: "MID", awaySlot: "MID" },
  { id: "goalkeepers", title: "Kaleciler", homeSlot: "GK", awaySlot: "GK" }
];

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function componentScore(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Math.round(Number(value));
}

function pairResult(homeValue, awayValue, confidence) {
  return { home: componentScore(homeValue), away: componentScore(awayValue), confidence: confidence ?? null };
}

function radarComponentValue(radar, key) {
  if (!radar || !Array.isArray(radar.components)) return null;
  const component = radar.components.find((item) => item.key === key);
  return component && component.value !== null && component.value !== undefined ? component.value : null;
}

function playerRating(player) {
  const value = Number(player && (player.overallRating ?? player.aiRating ?? player.rating ?? (player.radar && player.radar.overall)));
  return Number.isFinite(value) ? value : null;
}

function playerForm(player) {
  const radarForm = player && player.radar && player.radar.form;
  const value = Number(radarForm ?? (player && player.formRating));
  return Number.isFinite(value) ? value : playerRating(player);
}

function slotPlayers(lineup, slots) {
  return (lineup && Array.isArray(lineup.starters) ? lineup.starters : []).filter((player) => slots.includes(player.slot));
}

function slotAverage(lineup, slots) {
  const ratings = slotPlayers(lineup, slots).map(playerRating).filter((value) => value !== null);
  if (!ratings.length) return null;
  return ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
}

function bestSlotPlayer(lineup, slots) {
  const players = slotPlayers(lineup, slots).filter((player) => playerRating(player) !== null);
  if (!players.length) return null;
  return players.sort((left, right) => playerRating(right) - playerRating(left))[0];
}

function compareTeamUnits(homeAnalysis, awayAnalysis) {
  const homeScore = homeAnalysis && homeAnalysis.radar ? homeAnalysis.radar.score : null;
  const awayScore = awayAnalysis && awayAnalysis.radar ? awayAnalysis.radar.score : null;
  const confidence = Math.min(
    (homeAnalysis && homeAnalysis.radar && homeAnalysis.radar.coverage) ?? 0,
    (awayAnalysis && awayAnalysis.radar && awayAnalysis.radar.coverage) ?? 0
  );
  return pairResult(homeScore, awayScore, confidence);
}

function compareAttackVsDefense(attackingTeam, defendingTeam) {
  const attackScore = radarComponentValue(attackingTeam && attackingTeam.radar, "attack");
  const defenseScore = radarComponentValue(defendingTeam && defendingTeam.radar, "defense");
  if (attackScore === null || defenseScore === null) {
    return { score: null, confidence: 0 };
  }

  const edge = clamp(Math.round(50 + (attackScore - defenseScore) / 2), 0, 100);
  const confidence = Math.min(
    (attackingTeam.radar && attackingTeam.radar.coverage) ?? 0,
    (defendingTeam.radar && defendingTeam.radar.coverage) ?? 0
  );
  return { score: edge, confidence };
}

function compareMidfields(homeTeam, awayTeam) {
  const homeValue = slotAverage(homeTeam && homeTeam.lineup, ["MID"]);
  const awayValue = slotAverage(awayTeam && awayTeam.lineup, ["MID"]);
  const confidence = homeValue !== null && awayValue !== null
    ? Math.min((homeTeam.lineup && homeTeam.lineup.confidence) ?? 0, (awayTeam.lineup && awayTeam.lineup.confidence) ?? 0)
    : 0;
  return pairResult(homeValue, awayValue, confidence);
}

function compareWideAreas(homeTeam, awayTeam) {
  const homeValue = slotAverage(homeTeam && homeTeam.lineup, ["WING"]);
  const awayValue = slotAverage(awayTeam && awayTeam.lineup, ["WING"]);
  const confidence = homeValue !== null && awayValue !== null
    ? Math.min((homeTeam.lineup && homeTeam.lineup.confidence) ?? 0, (awayTeam.lineup && awayTeam.lineup.confidence) ?? 0)
    : 0;
  return pairResult(homeValue, awayValue, confidence);
}

function compareGoalkeepers(homeTeam, awayTeam) {
  const homeValue = slotAverage(homeTeam && homeTeam.lineup, ["GK"]);
  const awayValue = slotAverage(awayTeam && awayTeam.lineup, ["GK"]);
  const confidence = homeValue !== null && awayValue !== null ? 70 : 0;
  return pairResult(homeValue, awayValue, confidence);
}

function compareBenchStrength(homeTeam, awayTeam) {
  const homeValue = homeTeam && homeTeam.benchStrength ? homeTeam.benchStrength.score : null;
  const awayValue = awayTeam && awayTeam.benchStrength ? awayTeam.benchStrength.score : null;
  const confidence = Math.min(
    (homeTeam && homeTeam.benchStrength && homeTeam.benchStrength.confidence) ?? 0,
    (awayTeam && awayTeam.benchStrength && awayTeam.benchStrength.confidence) ?? 0
  );
  return pairResult(homeValue, awayValue, confidence);
}

function compareForm(homeContext, awayContext) {
  const homeValue = homeContext && homeContext.recentForm ? homeContext.recentForm.weightedScore : null;
  const awayValue = awayContext && awayContext.recentForm ? awayContext.recentForm.weightedScore : null;
  const confidence = Math.min((homeContext && homeContext.confidence) ?? 0, (awayContext && awayContext.confidence) ?? 0);
  return pairResult(homeValue, awayValue, confidence);
}

function compareAvailability(homeTeam, awayTeam) {
  const homeAvailability = homeTeam && homeTeam.lineup && homeTeam.lineup.availability;
  const awayAvailability = awayTeam && awayTeam.lineup && awayTeam.lineup.availability;
  const homeValue = homeAvailability && homeAvailability.totalKnownPlayers
    ? clamp(100 - homeAvailability.unavailableCount * 15, 0, 100)
    : null;
  const awayValue = awayAvailability && awayAvailability.totalKnownPlayers
    ? clamp(100 - awayAvailability.unavailableCount * 15, 0, 100)
    : null;
  const confidence = Math.min(
    (homeAvailability && homeAvailability.knownAvailabilityCoverage) ?? 0,
    (awayAvailability && awayAvailability.knownAvailabilityCoverage) ?? 0
  );
  return pairResult(homeValue, awayValue, confidence);
}

function buildComparison(homeTeam, awayTeam, homeContext, awayContext) {
  const homeAttackVsAwayDefense = compareAttackVsDefense(homeTeam, awayTeam);
  const awayAttackVsHomeDefense = compareAttackVsDefense(awayTeam, homeTeam);
  const midfield = compareMidfields(homeTeam, awayTeam);
  const wideAreas = compareWideAreas(homeTeam, awayTeam);
  const goalkeepers = compareGoalkeepers(homeTeam, awayTeam);
  const bench = compareBenchStrength(homeTeam, awayTeam);
  const form = compareForm(homeContext, awayContext);
  const availability = compareAvailability(homeTeam, awayTeam);

  const componentConfidences = {
    homeAttackVsAwayDefense: homeAttackVsAwayDefense.confidence,
    awayAttackVsHomeDefense: awayAttackVsHomeDefense.confidence,
    midfield: midfield.confidence,
    wideAreas: wideAreas.confidence,
    goalkeepers: goalkeepers.confidence,
    bench: bench.confidence,
    form: form.confidence,
    availability: availability.confidence
  };

  const availableWeights = Object.entries(COMPONENT_WEIGHTS).filter(([key]) => (componentConfidences[key] ?? 0) > 0);
  const totalWeight = availableWeights.reduce((sum, [, weight]) => sum + weight, 0);
  const confidence = totalWeight
    ? Math.round(availableWeights.reduce((sum, [key, weight]) => sum + (componentConfidences[key] || 0) * weight, 0) / totalWeight)
    : 0;

  return {
    homeAttackVsAwayDefense: homeAttackVsAwayDefense.score,
    awayAttackVsHomeDefense: awayAttackVsHomeDefense.score,
    midfield: { home: midfield.home, away: midfield.away },
    wideAreas: { home: wideAreas.home, away: wideAreas.away },
    goalkeepers: { home: goalkeepers.home, away: goalkeepers.away },
    bench: { home: bench.home, away: bench.away },
    form: { home: form.home, away: form.away },
    availability: { home: availability.home, away: availability.away },
    confidence
  };
}

function advantageFor(homeValue, awayValue, threshold) {
  if (homeValue === null || awayValue === null) return null;
  const delta = homeValue - awayValue;
  if (Math.abs(delta) < (threshold ?? 4)) return "balanced";
  return delta > 0 ? "home" : "away";
}

function generateMatchupAdvantages(comparison) {
  if (!comparison) return [];

  const entries = [
    { key: "attack", home: comparison.homeAttackVsAwayDefense, away: 100 - (comparison.awayAttackVsHomeDefense ?? 50), label: "Hücum-savunma dengesi" },
    { key: "midfield", home: comparison.midfield.home, away: comparison.midfield.away, label: "Orta saha" },
    { key: "wideAreas", home: comparison.wideAreas.home, away: comparison.wideAreas.away, label: "Kanat alanları" },
    { key: "goalkeepers", home: comparison.goalkeepers.home, away: comparison.goalkeepers.away, label: "Kaleciler" },
    { key: "bench", home: comparison.bench.home, away: comparison.bench.away, label: "Yedek kulübesi" },
    { key: "form", home: comparison.form.home, away: comparison.form.away, label: "Form" },
    { key: "availability", home: comparison.availability.home, away: comparison.availability.away, label: "Kadro devamlılığı" }
  ];

  return entries
    .map((entry) => ({ key: entry.key, label: entry.label, advantage: advantageFor(entry.home, entry.away) }))
    .filter((entry) => entry.advantage !== null);
}

function buildMatchupSummary(comparison) {
  if (!comparison || comparison.confidence === 0) {
    return "Maçı okumak için yeterli doğrulanmış veri henüz oluşmadı.";
  }

  const advantages = generateMatchupAdvantages(comparison);
  const homeWins = advantages.filter((item) => item.advantage === "home").length;
  const awayWins = advantages.filter((item) => item.advantage === "away").length;

  if (!advantages.length) {
    return "İki takımın mevcut verileri birbirine yakın; belirgin bir üstünlük görünmüyor.";
  }
  if (homeWins === awayWins) {
    return "Takımlar mevcut bileşenlerde birbirini dengeliyor; maç öncesi net bir üstünlük yok.";
  }

  const leader = homeWins > awayWins ? "Ev sahibi" : "Deplasman";
  const leadAreas = advantages
    .filter((item) => item.advantage === (homeWins > awayWins ? "home" : "away"))
    .map((item) => item.label)
    .slice(0, 2)
    .join(" ve ");

  return `${leader} mevcut verilerde ${leadAreas ? leadAreas + " alanlarında" : "birden fazla alanda"} bir adım önde görünüyor.`;
}

function usageKey(player) {
  return player && (player.id || player.name);
}

function buildDuel(template, homeTeam, awayTeam, usedHome, usedAway) {
  // Şablonun homeSlot/awaySlot alanları zaten TARAF BAŞINA yazılıdır
  // ("away-forward-vs-defense" = ev DEF, deplasman FWD). Eski `reversed`
  // takası kaynakları bir kez daha çeviriyordu: deplasman santrforu
  // `homePlayer` anahtarıyla yayımlanıyor, doğrulayıcının "oyuncu kendi
  // muhtemel 11'inde olmalı" kuralına takılıyor ve avantaj yönü ters
  // okunuyordu. Her taraf yalnızca KENDİ kadrosundan aday alır.
  const homeCandidates = slotPlayers(homeTeam.lineup, [template.homeSlot])
    .filter((player) => playerRating(player) !== null)
    .sort((left, right) => playerRating(right) - playerRating(left));
  const awayCandidates = slotPlayers(awayTeam.lineup, [template.awaySlot])
    .filter((player) => playerRating(player) !== null)
    .sort((left, right) => playerRating(right) - playerRating(left));

  const homePlayer = homeCandidates.find((player) => !usedHome.has(usageKey(player))) || homeCandidates[0];
  const awayPlayer = awayCandidates.find((player) => !usedAway.has(usageKey(player))) || awayCandidates[0];

  if (!homePlayer || !awayPlayer) return null;

  const homeCombined = (playerRating(homePlayer) ?? 0) * 0.6 + (playerForm(homePlayer) ?? 0) * 0.4;
  const awayCombined = (playerRating(awayPlayer) ?? 0) * 0.6 + (playerForm(awayPlayer) ?? 0) * 0.4;
  const delta = homeCombined - awayCombined;
  const advantage = Math.abs(delta) < 4 ? "balanced" : delta > 0 ? "home" : "away";
  const advantageScore = clamp(Math.round(50 + delta / 2), 0, 100);
  const bothInPosition = !homePlayer.outOfPosition && !awayPlayer.outOfPosition;
  const confidence = clamp(
    Math.round(((homeTeam.lineup && homeTeam.lineup.confidence) ?? 0) * 0.5 + ((awayTeam.lineup && awayTeam.lineup.confidence) ?? 0) * 0.5) - (bothInPosition ? 0 : 15),
    0,
    100
  );

  return {
    id: template.id,
    title: template.title,
    homePlayer: {
      id: homePlayer.id || null,
      name: homePlayer.name,
      position: homePlayer.position || null,
      overall: playerRating(homePlayer),
      form: playerForm(homePlayer),
      profileUrl: homePlayer.id ? `./oyuncular/${homePlayer.id}.html` : null
    },
    awayPlayer: {
      id: awayPlayer.id || null,
      name: awayPlayer.name,
      position: awayPlayer.position || null,
      overall: playerRating(awayPlayer),
      form: playerForm(awayPlayer),
      profileUrl: awayPlayer.id ? `./oyuncular/${awayPlayer.id}.html` : null
    },
    advantage,
    advantageScore,
    confidence,
    summary: advantage === "balanced"
      ? `${homePlayer.name} ve ${awayPlayer.name} arasındaki eşleşme mevcut verilerde dengeli görünüyor.`
      : advantage === "home"
        ? `${homePlayer.name}, mevcut form ve genel seviyesiyle bu eşleşmede bir adım önde görünüyor.`
        : `${awayPlayer.name}, mevcut form ve genel seviyesiyle bu eşleşmede bir adım önde görünüyor.`
  };
}

function generateKeyDuels(homeTeamOrLineup, awayTeamOrLineup, context) {
  const homeTeam = homeTeamOrLineup && homeTeamOrLineup.lineup ? homeTeamOrLineup : { lineup: homeTeamOrLineup };
  const awayTeam = awayTeamOrLineup && awayTeamOrLineup.lineup ? awayTeamOrLineup : { lineup: awayTeamOrLineup };

  if (!homeTeam.lineup || !awayTeam.lineup || homeTeam.lineup.predictionStatus === "unavailable" || awayTeam.lineup.predictionStatus === "unavailable") {
    return [];
  }

  const usedHome = new Set();
  const usedAway = new Set();
  const duels = [];

  for (const template of KEY_DUEL_TEMPLATES) {
    if (duels.length >= 5) break;
    const duel = buildDuel(template, homeTeam, awayTeam, usedHome, usedAway);
    if (duel) {
      usedHome.add(duel.homePlayer.id || duel.homePlayer.name);
      usedAway.add(duel.awayPlayer.id || duel.awayPlayer.name);
      duels.push(duel);
    }
  }

  if (duels.length < 5) {
    const homeLeader = bestSlotPlayer(homeTeam.lineup, ["FWD", "WING", "MID"]);
    const awayLeader = bestSlotPlayer(awayTeam.lineup, ["FWD", "WING", "MID"]);
    if (homeLeader && awayLeader && !usedHome.has(usageKey(homeLeader)) && !usedAway.has(usageKey(awayLeader))) {
      const duel = buildDuel(
        { id: "form-leaders", title: "Form karşılaştırması", homeSlot: homeLeader.slot, awaySlot: awayLeader.slot },
        { lineup: { starters: [homeLeader] } },
        { lineup: { starters: [awayLeader] }, confidence: awayTeam.lineup.confidence },
        usedHome,
        usedAway
      );
      if (duel) duels.push({ ...duel, confidence: Math.round(((homeTeam.lineup.confidence || 0) + (awayTeam.lineup.confidence || 0)) / 2) });
    }
  }

  return duels.slice(0, 5);
}

module.exports = {
  compareTeamUnits,
  compareAttackVsDefense,
  compareMidfields,
  compareWideAreas,
  compareGoalkeepers,
  compareBenchStrength,
  compareForm,
  compareAvailability,
  buildComparison,
  generateMatchupAdvantages,
  buildMatchupSummary,
  generateKeyDuels
};
