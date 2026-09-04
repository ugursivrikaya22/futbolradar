/**
 * FutbolRadar Oyuncu Skoru (0-100).
 *
 * Skor beş bileşenden türetilir: puan (maç reytingi), form (son maçlar),
 * istikrar (dalgalanma ve süreklilik), katkı (gol/asist veya savunma
 * üretimi) ve istatistik (pozisyona göre 90 dakikalık üretim).
 *
 * Kural: veri yoksa bileşen üretilmez. Eksik bileşen nötr bir varsayılanla
 * doldurulmaz; ağırlığı toplamdan düşer ve güven oranı buna göre raporlanır.
 * Güven eşiğin altındaysa skor `null` döner ve UI boş durum gösterir.
 */

const { PER90_BENCHMARKS, clamp, hasNumber, metricMap, round } = require("./playerMetricsService");

const MODEL_VERSION = "futbolradar-player-score-v1";

const COMPONENT_LABELS = {
  puan: "Puan",
  form: "Form",
  istikrar: "İstikrar",
  katki: "Katkı",
  istatistik: "İstatistik"
};

const COMPONENT_WEIGHTS = {
  forward: { puan: 26, form: 22, istikrar: 12, katki: 26, istatistik: 14 },
  winger: { puan: 26, form: 22, istikrar: 12, katki: 24, istatistik: 16 },
  midfielder: { puan: 26, form: 22, istikrar: 14, katki: 18, istatistik: 20 },
  defender: { puan: 28, form: 20, istikrar: 16, katki: 14, istatistik: 22 },
  goalkeeper: { puan: 30, form: 20, istikrar: 18, katki: 16, istatistik: 16 }
};

const MIN_CONFIDENCE_RATIO = 0.45;
const MIN_COMPONENT_COUNT = 2;

// Maç reytingi 0-10 ölçeğinde gelir. 5.2 altı düşük, 8.7 üstü elit kabul
// edilerek 0-100 aralığına doğrusal taşınır.
const RATING_FLOOR = 5.2;
const RATING_CEILING = 8.7;

function ratingToScore(rating) {
  if (!hasNumber(rating)) {
    return null;
  }

  const value = Number(rating);
  // 0-100 ölçeğinde gelen bir rating (model tarafı) yeniden ölçeklenmez.
  if (value > 10) {
    return clamp(Math.round(value), 0, 100);
  }

  return clamp(Math.round(((value - RATING_FLOOR) / (RATING_CEILING - RATING_FLOOR)) * 100), 0, 100);
}

function average(values) {
  const safe = values.filter(hasNumber).map(Number);
  if (!safe.length) {
    return null;
  }

  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
}

function standardDeviation(values) {
  const safe = values.filter(hasNumber).map(Number);
  if (safe.length < 2) {
    return null;
  }

  const mean = safe.reduce((sum, value) => sum + value, 0) / safe.length;
  const variance = safe.reduce((sum, value) => sum + (value - mean) ** 2, 0) / safe.length;
  return Math.sqrt(variance);
}

function component(key, value, source, note) {
  return {
    key,
    label: COMPONENT_LABELS[key] || key,
    value: value === null || value === undefined ? null : clamp(Math.round(Number(value)), 0, 100),
    source: value === null || value === undefined ? null : source || "provider",
    note: note || null,
    available: value !== null && value !== undefined
  };
}

function seasonRating(player, matchLog) {
  const logRatings = (Array.isArray(matchLog) ? matchLog : [])
    .map((match) => match && match.rating)
    .filter(hasNumber)
    .map(Number);

  if (logRatings.length >= 3) {
    return { value: average(logRatings), source: "provider" };
  }

  const direct = [player && player.providerRating, player && player.stats && player.stats.rating, player && player.matchRating]
    .find(hasNumber);
  if (hasNumber(direct)) {
    return { value: Number(direct), source: "provider" };
  }

  if (logRatings.length) {
    return { value: average(logRatings), source: "provider" };
  }

  const modelRating = [player && player.radar && player.radar.overall, player && player.overallRating, player && player.aiRating, player && player.rating]
    .find(hasNumber);
  if (hasNumber(modelRating)) {
    return { value: Number(modelRating), source: "model" };
  }

  return { value: null, source: null };
}

function formComponent(player, matchLog, formPoints) {
  const logRatings = (Array.isArray(matchLog) ? matchLog : [])
    .map((match) => match && match.rating)
    .filter(hasNumber)
    .map(Number);

  if (logRatings.length >= 2) {
    return component("form", ratingToScore(average(logRatings)), "provider", `Son ${logRatings.length} maç reyting ortalaması`);
  }

  const pointValues = (Array.isArray(formPoints) ? formPoints : [])
    .map((point) => (point && hasNumber(point.value) ? Number(point.value) : null))
    .filter(hasNumber);
  if (pointValues.length >= 2) {
    return component("form", ratingToScore(average(pointValues)), "curated", `Son ${pointValues.length} maç form eğrisi`);
  }

  if (hasNumber(player && player.formRating)) {
    return component("form", clamp(Number(player.formRating), 0, 100), "model", "Form modeli tahmini");
  }

  return component("form", null);
}

function consistencyComponent(player, matchLog, metrics) {
  const parts = [];
  const notes = [];
  const ratings = (Array.isArray(matchLog) ? matchLog : [])
    .map((match) => match && match.rating)
    .filter(hasNumber)
    .map(Number);
  const deviation = standardDeviation(ratings);

  if (deviation !== null) {
    parts.push(clamp(100 - deviation * 45, 0, 100));
    notes.push("maç reytingi dalgalanması");
  }

  const map = metricMap(metrics);
  const minutes = map.get("minutes");
  const appearances = map.get("appearances");
  if (minutes && minutes.available && appearances && appearances.available && Number(appearances.value) > 0) {
    const share = Number(minutes.value) / (Number(appearances.value) * 90);
    parts.push(clamp(share * 100, 0, 100));
    notes.push("maç başına oynanan dakika payı");
  }

  const starts = map.get("starts");
  if (starts && starts.available && appearances && appearances.available && Number(appearances.value) > 0) {
    parts.push(clamp((Number(starts.value) / Number(appearances.value)) * 100, 0, 100));
    notes.push("ilk 11 oranı");
  }

  if (!parts.length) {
    if (hasNumber(player && player.continuityScore)) {
      return component("istikrar", clamp(Number(player.continuityScore), 0, 100), "model", "Süreklilik modeli tahmini");
    }

    return component("istikrar", null);
  }

  return component("istikrar", average(parts), ratings.length ? "provider" : "provider", notes.join(", "));
}

function contributionComponent(metrics, group) {
  const map = metricMap(metrics);
  const benchmarks = PER90_BENCHMARKS[group] || PER90_BENCHMARKS.midfielder;
  const parts = [];
  const notes = [];

  function push(key, label, inverse) {
    const metric = map.get(key);
    const benchmark = benchmarks[key];
    if (!metric || !metric.available || !benchmark) {
      return;
    }

    const comparable = metric.per90 === null ? metric.value : metric.per90;
    if (!hasNumber(comparable)) {
      return;
    }

    const ratio = inverse ? benchmark / Math.max(Number(comparable), 0.01) : Number(comparable) / benchmark;
    parts.push(clamp(ratio * 70, 0, 100));
    notes.push(label);
  }

  if (group === "goalkeeper") {
    push("saves", "kurtarış");
    push("goalsConceded", "yenilen gol", true);
  } else if (group === "defender") {
    push("duelsWon", "ikili mücadele");
    push("tackles", "top kapma");
    push("interceptions", "araya girme");
    push("goals", "gol");
  } else {
    push("goals", "gol");
    push("assists", "asist");
    push("xg", "xG");
    push("xa", "xA");
  }

  if (!parts.length) {
    return component("katki", null);
  }

  return component("katki", average(parts), "provider", `${notes.join(", ")} üretimi`);
}

const STAT_KEYS_BY_GROUP = {
  forward: ["shots", "shotsOnTarget", "keyPasses", "dribbles", "duelsWon", "passAccuracy"],
  winger: ["shots", "keyPasses", "dribbles", "duelsWon", "passAccuracy"],
  midfielder: ["keyPasses", "passAccuracy", "dribbles", "duelsWon", "tackles", "interceptions"],
  defender: ["duelsWon", "tackles", "interceptions", "blocks", "passAccuracy"],
  goalkeeper: ["saves", "cleanSheets", "passAccuracy"]
};

function statisticsComponent(metrics, group) {
  const map = metricMap(metrics);
  const keys = STAT_KEYS_BY_GROUP[group] || STAT_KEYS_BY_GROUP.midfielder;
  const scores = keys
    .map((key) => map.get(key))
    .filter((metric) => metric && metric.available && metric.benchmarkScore !== null)
    .map((metric) => metric.benchmarkScore);

  if (!scores.length) {
    return component("istatistik", null);
  }

  return component("istatistik", average(scores), "provider", `${scores.length} metrik referansa göre değerlendirildi`);
}

function scoreLabel(value) {
  if (value === null) {
    return null;
  }
  if (value >= 85) return "Elit";
  if (value >= 75) return "Çok iyi";
  if (value >= 65) return "İyi";
  if (value >= 55) return "Orta";
  if (value >= 45) return "Gelişim";
  return "Sınırlı";
}

function confidenceLabel(ratio) {
  if (ratio >= 0.8) return "Yüksek";
  if (ratio >= 0.6) return "Orta";
  if (ratio >= MIN_CONFIDENCE_RATIO) return "Sınırlı";
  return "Yetersiz";
}

/**
 * Oyuncu skorunu ve bileşen kırılımını üretir.
 *
 * @param {object} input.player normalize edilmiş oyuncu kaydı
 * @param {Array} input.metrics playerMetricsService.buildMetrics çıktısı
 * @param {Array} input.matchLog son maç kayıtları (opsiyonel)
 * @param {Array} input.formPoints form eğrisi noktaları (opsiyonel)
 * @param {string} input.positionGroup pozisyon grubu
 */
function computePlayerScore(input) {
  const settings = input || {};
  const player = settings.player || {};
  const metrics = settings.metrics || [];
  const matchLog = settings.matchLog || [];
  const group = settings.positionGroup || "midfielder";
  const weights = COMPONENT_WEIGHTS[group] || COMPONENT_WEIGHTS.midfielder;

  const rating = seasonRating(player, matchLog);
  const components = [
    component("puan", ratingToScore(rating.value), rating.source, rating.source === "model"
      ? "Sağlayıcı maç reytingi yok; FutbolRadar rating modeli kullanıldı"
      : "Maç reytingi ortalaması"),
    formComponent(player, matchLog, settings.formPoints),
    consistencyComponent(player, matchLog, metrics),
    contributionComponent(metrics, group),
    statisticsComponent(metrics, group)
  ].map((item) => ({ ...item, weight: weights[item.key] || 0 }));

  const availableComponents = components.filter((item) => item.available);
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0) || 1;
  const availableWeight = availableComponents.reduce((sum, item) => sum + item.weight, 0);
  const ratio = round(availableWeight / totalWeight, 2);
  const enough = availableComponents.length >= MIN_COMPONENT_COUNT && ratio >= MIN_CONFIDENCE_RATIO;
  const value = enough
    ? clamp(Math.round(availableComponents.reduce((sum, item) => sum + item.value * item.weight, 0) / availableWeight), 0, 100)
    : null;
  const modelOnly = availableComponents.length > 0 && availableComponents.every((item) => item.source === "model");

  return {
    value,
    label: scoreLabel(value),
    available: value !== null,
    reason: value === null
      ? "Skor için yeterli performans verisi yok; sağlayıcıdan maç istatistiği geldiğinde hesaplanır."
      : null,
    confidence: {
      ratio,
      label: confidenceLabel(ratio),
      componentCount: availableComponents.length,
      totalComponents: components.length,
      modelOnly
    },
    components,
    positionGroup: group,
    method: MODEL_VERSION,
    formula: "Skor = (Puan, Form, İstikrar, Katkı, İstatistik) bileşenlerinin pozisyona göre ağırlıklı ortalamasıdır. Verisi olmayan bileşen hesaba katılmaz.",
    weights
  };
}

module.exports = {
  COMPONENT_LABELS,
  COMPONENT_WEIGHTS,
  MIN_CONFIDENCE_RATIO,
  MODEL_VERSION,
  computePlayerScore,
  ratingToScore,
  scoreLabel,
  standardDeviation
};
