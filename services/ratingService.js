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

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function average(values, fallback) {
  const safe = values.filter(hasNumber).map(Number);
  if (!safe.length) {
    return fallback;
  }

  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
}

function score(value, max) {
  if (!hasNumber(value) || !hasNumber(max) || Number(max) === 0) {
    return null;
  }

  return clamp((Number(value) / Number(max || 1)) * 100, 0, 100);
}

function numberFrom(player, keys, fallback) {
  const key = keys.find((item) => hasNumber(player[item]));
  return key ? Number(player[key]) : fallback;
}

function statValue(player, key, fallback) {
  if (player.stats && hasNumber(player.stats[key])) {
    return Number(player.stats[key]);
  }

  return numberFrom(player, [key], fallback);
}

/**
 * MEVKİ GRUBU — sağlayıcının sözcük dağarcığı da tanınmak zorunda.
 *
 * Bu eşleme kurulurken yalnızca kürasyonlu Türkçe mevki adları vardı
 * ("Stoper", "Sağ bek", "Santrfor"). API-Football ise dört geniş İngilizce
 * etiket döndürüyor: Goalkeeper / Defender / Midfielder / Attacker. Üçü
 * tesadüfen eşleşiyordu — "goalkeeper" ve "midfield" listede vardı,
 * "attacker" da zaten varsayılan olan "forward"a düşüyordu. DEFENDER
 * EŞLEŞMİYORDU: hiçbir kalıba uymadığı için son satıra, yani "forward"a
 * düşüyordu.
 *
 * Sonuç sessiz ama büyüktü: 526 güncel Süper Lig oyuncusunun 165'i —
 * ligin defans oyuncularının neredeyse tamamı — FORVET sayıldı. Bu grup
 * yalnızca etiket değil; `computeOverallRating` puanı gruba göre farklı
 * ağırlıklarla hesaplıyor, sıralama sayfaları ve radar grafikleri de gruba
 * bakıyor. Yani bir stoper, forvet ölçütleriyle puanlanıp "forvetler"
 * listesinde görünüyordu.
 *
 * Varsayılanın "forward" olması bu hatayı görünmez yapan şeydi: tanınmayan
 * her değer sessizce forvet oluyor. Tanınmayan değer artık "unknown"
 * dönüyor ki bir daha aynı hata bir mevki grubunun içinde saklanmasın.
 */
function positionGroup(position) {
  const normalized = normalizeText(position);

  if (!normalized) {
    return "unknown";
  }

  if (normalized.includes("kaleci") || normalized.includes("goalkeeper") || normalized === "gk") {
    return "goalkeeper";
  }

  // Kanat kontrolü defanstan ÖNCE gelmiyor: "wing back" bir defans oyuncusu.
  // Ama "sol kanat"/"sağ kanat" hücum mevkileri; onlar "bek"/"back" içermez.
  if (
    normalized.includes("stoper") ||
    normalized.includes("defans") ||
    normalized.includes("defender") ||
    normalized.includes("defence") ||
    normalized.includes("defense") ||
    normalized.includes("bek") ||
    normalized.includes("back") ||
    normalized.includes("libero") && normalized.includes("son")
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
    // Aksansız/harfi düşmüş yazımlar da gelebiliyor: "On numara".
    normalized.includes("on numara") ||
    normalized.includes("merkez") ||
    normalized.includes("midfield") ||
    // "Ön libero" is the Turkish term for the holding midfielder, not a
    // sweeper; without this it falls through and is treated as a striker.
    normalized.includes("libero")
  ) {
    return "midfielder";
  }

  if (
    normalized.includes("forvet") ||
    normalized.includes("santrfor") ||
    normalized.includes("santrafor") ||
    normalized.includes("striker") ||
    normalized.includes("attack") ||
    normalized.includes("forward") ||
    normalized.includes("hucum")
  ) {
    return "forward";
  }

  return "unknown";
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
  const yellow = statValue(player, "yellowCards", null);
  const red = statValue(player, "redCards", null);
  const appearancesValue = statValue(player, "appearances", null);
  if (![yellow, red, appearancesValue].every(hasNumber)) {
    return 65;
  }

  const appearances = Math.max(1, appearancesValue);
  const cardLoad = (yellow / appearances) * 30 + red * 18;
  return clamp(100 - cardLoad, 0, 100);
}

function durabilityScore(player) {
  const minutes = statValue(player, "minutesPlayed", hasNumber(player.minutes) ? Number(player.minutes) : null);
  const appearances = statValue(player, "appearances", null);
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

function perNinety(value, minutes) {
  if (!hasNumber(value) || !hasNumber(minutes) || Number(minutes) < 90) {
    return null;
  }

  return (Number(value) / Number(minutes)) * 90;
}

const ATTACK_PER90_BENCHMARK = {
  forward: { goals: 0.6, assists: 0.3 },
  winger: { goals: 0.4, assists: 0.4 }
};

/**
 * Forvet/kanat hücum skoru gol/90 ve katkı (gol+asist)/90 üretimine dayanır.
 * Şut/xG alanı gol atılmışken "0" geliyorsa sağlayıcı bu alanı hiç ölçmemiş
 * demektir (0 şut/0 xG ile gol atmak imkânsız); bu durumda o alan ortalamaya
 * uydurma düşük değer olarak girmez. Az dakikalı örneklemde oranın uç
 * değerlere savrulmaması için dakika sayısına göre nötr bir taban puana
 * (60) doğru yumuşatılır.
 */
function attackingProductionScore(player, group, goals, assists, shots, xg) {
  const minutes = statValue(player, "minutesPlayed", hasNumber(player.minutes) ? Number(player.minutes) : null);
  const benchmark = ATTACK_PER90_BENCHMARK[group] || ATTACK_PER90_BENCHMARK.forward;
  const goals90 = perNinety(goals, minutes);
  const assists90 = perNinety(assists, minutes);
  const sampleWeight = hasNumber(minutes) ? clamp(Number(minutes) / (Number(minutes) + 450), 0, 1) : 0;

  function shrink(raw) {
    return raw === null ? null : raw * sampleWeight + 60 * (1 - sampleWeight);
  }

  const goalRateScore = goals90 !== null
    ? shrink(clamp((goals90 / benchmark.goals) * 70, 0, 100))
    : (hasNumber(goals) ? score(goals, group === "winger" ? 8 : 10) : null);

  const contributionScore = goals90 !== null || assists90 !== null
    ? shrink(clamp((((goals90 || 0) + (assists90 || 0)) / (benchmark.goals + benchmark.assists)) * 70, 0, 100))
    : (hasNumber(goals) || hasNumber(assists))
      ? score(Number(goals || 0) + Number(assists || 0), group === "winger" ? 10 : 12)
      : null;

  const shotsReal = hasNumber(shots) && !(Number(goals) > 0 && Number(shots) === 0);
  const xgReal = hasNumber(xg) && !(Number(goals) > 0 && Number(xg) === 0);

  const signals = [
    Number(player.attackingRating),
    Number(player.shootingRating),
    Number(player.threatScore),
    goalRateScore,
    contributionScore,
    shotsReal ? score(shots, 22) : null,
    xgReal ? score(xg, 6) : null
  ].filter(hasNumber);

  const hasAnyData = hasNumber(goals) || hasNumber(assists) || shotsReal || xgReal ||
    hasNumber(player.attackingRating) || hasNumber(player.shootingRating) || hasNumber(player.threatScore);

  return { value: signals.length ? average(signals, null) : null, hasAnyData };
}

function computePlayerRadar(player, context) {
  const group = positionGroup(player.position);
  const stats = player.stats || {};
  const goals = statValue(player, "goals", null);
  const assists = statValue(player, "assists", null);
  const shots = numberFrom({ value: player.shots ?? stats.shots }, ["value"], null);
  const keyPasses = numberFrom({ value: player.keyPasses ?? stats.keyPasses }, ["value"], null);
  const xg = numberFrom({ value: player.xg ?? stats.xg }, ["value"], null);
  const xa = numberFrom({ value: player.xa ?? stats.xa }, ["value"], null);
  const tackles = numberFrom({ value: player.tacklesPerGame ?? stats.tacklesPerGame }, ["value"], null);
  const interceptions = numberFrom({ value: player.interceptionsPerGame ?? stats.interceptionsPerGame }, ["value"], null);
  const cleanSheets = numberFrom({ value: player.cleanSheets ?? stats.cleanSheets }, ["value"], null);
  const goalsConceded = numberFrom({ value: player.goalsConceded ?? stats.goalsConceded }, ["value"], null);
  const existingRadar = player.radar && typeof player.radar === "object" ? player.radar : {};

  const isAttackingGroup = group === "forward" || group === "winger";
  const attackingProduction = isAttackingGroup
    ? attackingProductionScore(player, group, goals, assists, shots, xg)
    : null;

  // Forvet/kanat için gol/90 ve katkı verisi hiç yoksa (ne gol/asist ne şut/xG
  // ne de elle girilmiş bir hücum reytingi) uydurma bir taban puan basılmaz;
  // `attack` null kalır ve genel rating "veri yetersiz" olarak işaretlenir.
  const attack = isAttackingGroup
    ? attackingProduction.value
    : clamp(average([
      Number(player.attackingRating),
      Number(player.shootingRating),
      Number(player.threatScore),
      existingRadar.attack,
      existingRadar.finishing,
      score(goals, 6),
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
    group === "goalkeeper" && hasNumber(goalsConceded) ? clamp(100 - goalsConceded * 8, 0, 100) : null,
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
    attack: attack === null ? null : Math.round(clamp(attack, 0, 100)),
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

function isInsufficientForRating(playerRadar, group) {
  return (group === "forward" || group === "winger") && playerRadar && playerRadar.attack === null;
}

function computeOverallRating(playerRadar, group, player) {
  const weights = POSITION_WEIGHTS[group] || POSITION_WEIGHTS.forward;
  const existing = Number(player && (player.overallRating || player.aiRating || player.rating));
  const manualRating = player && normalizeText(player.ratingStatus).includes("manual");

  if (manualRating && Number.isFinite(existing)) {
    return clamp(Math.round(existing), 0, 100);
  }

  // Forvet/kanat için gol/90 ve katkı verisi yoksa (bkz. attackingProductionScore)
  // uydurma bir düşük skor basmak yerine rating hiç üretilmez; çağıran taraf
  // bunu "veri yetersiz" olarak işaretler.
  if (!manualRating && isInsufficientForRating(playerRadar, group)) {
    return null;
  }

  const computed = weighted(playerRadar || {}, weights);

  if (Number.isFinite(existing) && existing > 0) {
    return clamp(Math.round(computed * 0.62 + existing * 0.38), 0, 100);
  }

  return clamp(Math.round(computed), 0, 100);
}

const STRENGTH_LABELS = [
  ["attack", "Hücum tehdidi"],
  ["creativity", "Yaratıcılık"],
  ["defense", "Savunma katkısı"],
  ["form", "Form ivmesi"],
  ["durability", "Süreklilik"],
  ["potential", "Gelişim potansiyeli"],
  ["discipline", "Disiplin"],
  ["dataConfidence", "Veri güveni"]
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
    .map((item) => item.label + " geliştirilmeli");
}

function computePlayerRating(player, context) {
  const group = positionGroup(player.position);
  const radar = computePlayerRadar(player, context || {});
  const aiRating = radar.overall;
  const manualRating = normalizeText(player.ratingStatus).includes("manual");
  const insufficientData = aiRating === null && !manualRating;

  return {
    aiRating,
    overallRating: aiRating,
    ratingStatus: manualRating
      ? player.ratingStatus
      : (insufficientData ? "insufficient_data" : (player.ratingStatus === "provider" ? "provider" : "estimated")),
    ratingExplanation: insufficientData
      ? "Bu oyuncu için gol/90 ve katkı verisi yok; rating hesaplanamadı."
      : "Bu rating; pozisyona göre ağırlıklanan hücum, yaratıcılık, savunma, form, süreklilik, potansiyel ve veri güveni skorlarından hesaplanır.",
    ratingComponents: radar,
    radar,
    positionGroup: group,
    strengths: insufficientData ? [] : deriveStrengths(player, radar),
    weaknesses: insufficientData ? [] : deriveWeaknesses(player, radar)
  };
}

function enrichPlayerRating(player, context) {
  const result = computePlayerRating(player, context);
  const manualRating = normalizeText(player.ratingStatus).includes("manual");
  const protectedValue = Number(player.overallRating || player.aiRating || player.rating);
  const insufficientData = result.ratingStatus === "insufficient_data";
  const rating = manualRating && Number.isFinite(protectedValue) ? clamp(Math.round(protectedValue), 0, 100) : result.aiRating;

  return {
    ...player,
    aiRating: rating,
    rating: insufficientData ? null : (player.rating || rating),
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
