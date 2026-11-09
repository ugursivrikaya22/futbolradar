/**
 * Oyuncu istatistiklerinin tek kanonik sözlüğü.
 *
 * Her sağlayıcı aynı metriği farklı adla gönderiyor (`minutes` /
 * `minutesPlayed`, `duels.won` / `duelsWon`, `passes.accuracy` /
 * `passAccuracy`). Bu katman alan adlarını tek bir sözlüğe indirger ve her
 * metrik için "veri var mı" bilgisini ayrı taşır. Böylece UI, eksik bir
 * metriği 0 sanıp uydurma bir değer basmak yerine boş durum gösterebilir.
 */

const METRIC_CATALOG = [
  { key: "appearances", label: "Maç", group: "genel", aliases: ["appearances", "appearences", "matches"], per90: false },
  { key: "starts", label: "İlk 11", group: "genel", aliases: ["starts", "lineups"], per90: false },
  { key: "minutes", label: "Dakika", group: "genel", aliases: ["minutes", "minutesPlayed"], per90: false },
  { key: "goals", label: "Gol", group: "hucum", aliases: ["goals"], per90: true },
  { key: "assists", label: "Asist", group: "hucum", aliases: ["assists"], per90: true },
  { key: "shots", label: "Şut", group: "hucum", aliases: ["shots", "shotsTotal"], per90: true },
  { key: "shotsOnTarget", label: "İsabetli şut", group: "hucum", aliases: ["shotsOnTarget", "shotsOn"], per90: true },
  { key: "xg", label: "xG", group: "hucum", aliases: ["xg", "expectedGoals"], per90: true, decimals: 2 },
  { key: "xa", label: "xA", group: "yaraticilik", aliases: ["xa", "expectedAssists"], per90: true, decimals: 2 },
  { key: "keyPasses", label: "Kilit pas", group: "yaraticilik", aliases: ["keyPasses"], per90: true },
  { key: "passAccuracy", label: "Pas isabeti", group: "yaraticilik", aliases: ["passAccuracy", "passesAccuracy"], unit: "%", per90: false },
  { key: "passes", label: "Pas", group: "yaraticilik", aliases: ["passes", "passesTotal"], per90: true },
  { key: "dribbles", label: "Dripling", group: "yaraticilik", aliases: ["dribbles", "dribblesSuccess", "successfulDribbles"], per90: true },
  { key: "dribbleAttempts", label: "Dripling denemesi", group: "yaraticilik", aliases: ["dribbleAttempts", "dribblesAttempts"], per90: true },
  { key: "duelsWon", label: "Kazanılan ikili mücadele", group: "mucadele", aliases: ["duelsWon", "duels"], per90: true },
  { key: "duelsTotal", label: "İkili mücadele", group: "mucadele", aliases: ["duelsTotal"], per90: true },
  { key: "tackles", label: "Top kapma", group: "mucadele", aliases: ["tackles", "tacklesTotal"], per90: true },
  { key: "interceptions", label: "Araya girme", group: "mucadele", aliases: ["interceptions"], per90: true },
  { key: "blocks", label: "Blok", group: "mucadele", aliases: ["blocks"], per90: true },
  { key: "recoveries", label: "Top alma", group: "mucadele", aliases: ["recoveries", "ballRecoveries"], per90: true },
  { key: "foulsCommitted", label: "Faul", group: "disiplin", aliases: ["foulsCommitted", "fouls"], per90: true },
  { key: "yellowCards", label: "Sarı kart", group: "disiplin", aliases: ["yellowCards"], per90: false },
  { key: "redCards", label: "Kırmızı kart", group: "disiplin", aliases: ["redCards"], per90: false },
  { key: "saves", label: "Kurtarış", group: "kaleci", aliases: ["saves"], per90: true, positions: ["goalkeeper"] },
  { key: "cleanSheets", label: "Gol yemeden", group: "kaleci", aliases: ["cleanSheets"], per90: false, positions: ["goalkeeper"] },
  { key: "goalsConceded", label: "Yenilen gol", group: "kaleci", aliases: ["goalsConceded"], per90: true, positions: ["goalkeeper"] }
];

const METRIC_BY_KEY = new Map(METRIC_CATALOG.map((metric) => [metric.key, metric]));

const PER_GAME_ALIASES = {
  shots: "shotsPerGame",
  tackles: "tacklesPerGame",
  interceptions: "interceptionsPerGame"
};

// Her pozisyon grubunda "iyi" kabul edilen 90 dakikalık üretim referansı.
// Değerler modelin ölçeğini tanımlar; oyuncuya ait bir veri yoksa hiçbir
// referans skora dönüşmez, metrik yalnızca boş durum olarak işaretlenir.
const PER90_BENCHMARKS = {
  forward: { goals: 0.6, assists: 0.3, shots: 3.2, xg: 0.55, xa: 0.25, keyPasses: 1.6, dribbles: 1.8, duelsWon: 4.5, passAccuracy: 78 },
  winger: { goals: 0.4, assists: 0.4, shots: 2.6, xg: 0.38, xa: 0.32, keyPasses: 2.2, dribbles: 2.6, duelsWon: 5, passAccuracy: 80 },
  midfielder: { goals: 0.2, assists: 0.3, shots: 1.4, xg: 0.18, xa: 0.28, keyPasses: 2, dribbles: 1.4, duelsWon: 5.5, tackles: 2.2, interceptions: 1.4, passAccuracy: 86 },
  defender: { goals: 0.08, assists: 0.12, shots: 0.6, xg: 0.08, xa: 0.12, keyPasses: 0.8, dribbles: 0.6, duelsWon: 6, tackles: 2.4, interceptions: 1.8, blocks: 1, passAccuracy: 85 },
  goalkeeper: { saves: 3, cleanSheets: 0.35, goalsConceded: 1.1, passAccuracy: 72 }
};

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function toNumber(value) {
  return hasNumber(value) ? Number(value) : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals) {
  const factor = 10 ** (decimals || 0);
  return Math.round(Number(value) * factor) / factor;
}

function readRaw(source, aliases) {
  if (!source || typeof source !== "object") {
    return null;
  }

  for (const alias of aliases) {
    if (hasNumber(source[alias])) {
      return Number(source[alias]);
    }
  }

  return null;
}

/**
 * Tek bir metriğin ham değerini oyuncu kaydından okur. `stats` nesnesi
 * önceliklidir; sağlayıcı düz alan gönderdiyse kök seviyeye düşer. Maç
 * başına ortalama olarak gelen alanlar (`shotsPerGame`) maç sayısıyla
 * çarpılarak sezon toplamına çevrilir - yalnızca maç sayısı biliniyorsa.
 */
function readMetric(player, metric, context) {
  const stats = player && player.stats && typeof player.stats === "object" ? player.stats : {};
  // A sourced season snapshot is authoritative: no legacy flat values or
  // per-game estimates may leak back into missing provider fields.
  if (player?.seasonStatistics?.provider === "api-football") return toNumber(stats[metric.key]);
  const direct = readRaw(stats, metric.aliases);
  if (direct !== null) {
    return direct;
  }

  const flat = readRaw(player, metric.aliases);
  if (flat !== null) {
    return flat;
  }

  const perGameKey = PER_GAME_ALIASES[metric.key];
  const appearances = context && hasNumber(context.appearances) ? Number(context.appearances) : null;
  if (perGameKey && appearances) {
    const perGame = readRaw(stats, [perGameKey]) ?? readRaw(player, [perGameKey]);
    if (perGame !== null) {
      return round(perGame * appearances, 1);
    }
  }

  return null;
}

function formatMetricValue(metric, value) {
  if (value === null) {
    return null;
  }

  const decimals = metric.decimals || 0;
  const rounded = round(value, decimals);
  return `${decimals ? rounded.toFixed(decimals) : rounded}${metric.unit || ""}`;
}

function per90Value(metric, value, minutes) {
  if (!metric.per90 || value === null || !hasNumber(minutes) || Number(minutes) < 90) {
    return null;
  }

  return round((Number(value) / Number(minutes)) * 90, 2);
}

/**
 * Oyuncunun sezon metriklerini kanonik listeye çevirir.
 * Dönen her satır `available` bayrağı taşır; false ise UI boş durum basar.
 */
function buildMetrics(player, options) {
  const settings = options || {};
  const group = settings.positionGroup || "midfielder";
  const appearances = readMetric(player, METRIC_BY_KEY.get("appearances"), {});
  const minutes = readMetric(player, METRIC_BY_KEY.get("minutes"), {});
  const context = { appearances, minutes };

  return METRIC_CATALOG
    .filter((metric) => !metric.positions || metric.positions.includes(group))
    .filter((metric) => group !== "goalkeeper" || metric.group !== "hucum" || metric.key === "assists")
    .map((metric) => {
      const value = readMetric(player, metric, context);
      const per90 = per90Value(metric, value, minutes);
      const benchmark = (PER90_BENCHMARKS[group] || {})[metric.key] ?? null;
      // Referans karşılaştırması hacim metriklerinde 90 dakikaya normalize
      // edilmiş değerle, oran metriklerinde (pas isabeti) ham değerle yapılır.
      const comparable = metric.per90 ? per90 : value;

      return {
        source: player?.seasonStatistics?.evidence?.[metric.key]?.source || null,
        sourceField: player?.seasonStatistics?.evidence?.[metric.key]?.field || null,
        formula: player?.seasonStatistics?.evidence?.[metric.key]?.formula || null,
        per90Formula: per90 === null ? null : "değer / dakika × 90",
        key: metric.key,
        label: metric.label,
        group: metric.group,
        unit: metric.unit || "",
        value,
        display: formatMetricValue(metric, value),
        per90,
        per90Display: per90 === null ? null : String(per90),
        benchmark,
        // Referansa göre 0-100 arası konum: yalnızca hem değer hem referans
        // varsa üretilir, aksi hâlde null kalır ve skora hiç girmez.
        benchmarkScore: comparable !== null && benchmark ? clamp(Math.round((comparable / benchmark) * 70), 0, 100) : null,
        available: value !== null
      };
    });
}

function metricMap(metrics) {
  return new Map((Array.isArray(metrics) ? metrics : []).map((metric) => [metric.key, metric]));
}

function metricValue(metrics, key) {
  const metric = metricMap(metrics).get(key);
  return metric && metric.available ? metric.value : null;
}

function metricPer90(metrics, key) {
  const metric = metricMap(metrics).get(key);
  return metric ? metric.per90 : null;
}

function coverage(metrics) {
  const list = Array.isArray(metrics) ? metrics : [];
  const available = list.filter((metric) => metric.available).length;
  return {
    available,
    total: list.length,
    ratio: list.length ? round(available / list.length, 2) : 0
  };
}

module.exports = {
  METRIC_CATALOG,
  PER90_BENCHMARKS,
  buildMetrics,
  clamp,
  coverage,
  hasNumber,
  metricMap,
  metricPer90,
  metricValue,
  per90Value,
  round,
  toNumber
};
