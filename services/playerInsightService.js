/**
 * Oyuncu radarının yorum katmanı: form eğrisi, performans trendi, AI destekli
 * kısa analiz özeti, güçlü/geliştirilecek yönler, benzer oyuncular ve aynı
 * mevkideki alternatifler.
 *
 * Tüm cümleler yalnızca elde bulunan sayısal veriden kurulur. Bir metrik yoksa
 * o cümle hiç yazılmaz; "muhtemelen", "tahminen" gibi doldurma ifadeleriyle
 * boşluk kapatılmaz.
 */

const { PER90_BENCHMARKS, hasNumber, metricMap, round } = require("./playerMetricsService");
const { positionLabelTr } = require("./playerLabels");

const POSITION_LABELS = {
  goalkeeper: "kaleci",
  defender: "defans",
  midfielder: "orta saha",
  winger: "kanat",
  forward: "forvet"
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .trim()
    .toLowerCase();
}

function average(values) {
  const safe = values.filter(hasNumber).map(Number);
  if (!safe.length) {
    return null;
  }

  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
}

function resultFromScore(match) {
  if (!match || !hasNumber(match.teamGoals) || !hasNumber(match.opponentGoals)) {
    return match && match.result ? match.result : null;
  }

  if (Number(match.teamGoals) > Number(match.opponentGoals)) return "win";
  if (Number(match.teamGoals) < Number(match.opponentGoals)) return "loss";
  return "draw";
}

/**
 * Form eğrisinin noktaları. Öncelik sağlayıcı maç reytingleri; yoksa veri
 * katmanındaki kürasyonlu form dizisi kullanılır. İkisi de yoksa boş döner.
 */
function buildFormPoints(player, matchLog) {
  const log = Array.isArray(matchLog) ? matchLog : [];
  const rated = log.filter((match) => hasNumber(match && match.rating));

  if (rated.length) {
    return rated
      .slice()
      .sort((left, right) => String(left.date || "").localeCompare(String(right.date || "")))
      .map((match) => ({
        label: round(Number(match.rating), 1).toFixed(1),
        value: round(Number(match.rating), 2),
        result: resultFromScore(match),
        date: match.date || null,
        opponent: match.opponent || null,
        source: "provider"
      }));
  }

  const curated = Array.isArray(player && player.form) ? player.form : [];
  const points = curated
    .map((item) => {
      const value = Number(item && item.label);
      return Number.isFinite(value)
        ? { label: String(item.label), value: round(value, 2), result: item.result || null, date: null, opponent: null, source: "curated" }
        : null;
    })
    .filter(Boolean);

  return points;
}

function trendDirection(points) {
  const values = points.map((point) => point.value).filter(hasNumber);
  if (values.length < 3) {
    return { direction: null, delta: null };
  }

  const half = Math.floor(values.length / 2);
  const older = average(values.slice(0, half));
  const recent = average(values.slice(values.length - half));
  if (older === null || recent === null) {
    return { direction: null, delta: null };
  }

  const delta = round(recent - older, 2);
  if (delta >= 0.25) return { direction: "up", delta };
  if (delta <= -0.25) return { direction: "down", delta };
  return { direction: "flat", delta };
}

const TREND_LABELS = {
  up: "Yükselen",
  down: "Düşen",
  flat: "Dengeli"
};

function buildFormTrend(player, matchLog) {
  const points = buildFormPoints(player, matchLog);
  if (!points.length) {
    return {
      available: false,
      points: [],
      direction: null,
      directionLabel: null,
      delta: null,
      average: null,
      sampleSize: 0,
      source: null,
      note: "Form eğrisi için maç bazlı performans verisi henüz yok."
    };
  }

  const { direction, delta } = trendDirection(points);
  const mean = average(points.map((point) => point.value));

  return {
    available: true,
    points,
    direction,
    directionLabel: direction ? TREND_LABELS[direction] : null,
    delta,
    average: mean === null ? null : round(mean, 2),
    sampleSize: points.length,
    source: points[0].source,
    note: points[0].source === "curated"
      ? "Form eğrisi FutbolRadar veri katmanındaki son maç puanlarından üretildi."
      : "Form eğrisi sağlayıcının maç reytinglerinden üretildi."
  };
}

function sentenceCase(value) {
  const text = String(value || "").trim();
  if (!text) {
    return text;
  }

  return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
}

function formatNumber(value, decimals) {
  if (!hasNumber(value)) {
    return null;
  }

  const rounded = round(Number(value), decimals || 0);
  return decimals ? rounded.toFixed(decimals) : String(rounded);
}

/**
 * Kısa analiz özeti: sezon üretimi, form yönü ve öne çıkan metrikten
 * en fazla dört cümle kurar. Yalnızca dolu metrikler cümleye girer.
 */
function buildAnalysis(context) {
  const { player, metrics, formTrend, score, positionGroup, recent } = context;
  const map = metricMap(metrics);
  const sentences = [];
  const sources = [];
  const name = player && player.name ? player.name : "Oyuncu";
  const roleLabel = POSITION_LABELS[positionGroup] || "oyuncu";

  const appearances = map.get("appearances");
  const minutes = map.get("minutes");
  const goals = map.get("goals");
  const assists = map.get("assists");

  if (appearances && appearances.available && minutes && minutes.available) {
    const goalPart = goals && goals.available ? `${goals.value} gol` : null;
    const assistPart = assists && assists.available ? `${assists.value} asist` : null;
    const production = [goalPart, assistPart].filter(Boolean).join(" ve ");
    sentences.push(
      production
        ? `${name}, bu sezon ${appearances.value} maçta ${minutes.value} dakika oynadı ve ${production} üretti.`
        : `${name}, bu sezon ${appearances.value} maçta ${minutes.value} dakika süre aldı.`
    );
    sources.push("sezon istatistikleri");
  }

  const contribution = goals && goals.available && assists && assists.available && minutes && minutes.available && Number(minutes.value) >= 90
    ? round(((Number(goals.value) + Number(assists.value)) / Number(minutes.value)) * 90, 2)
    : null;
  if (contribution !== null) {
    sentences.push(`90 dakika başına gol katkısı ${contribution.toFixed(2)}.`);
    sources.push("90 dakikalık üretim");
  }

  if (formTrend && formTrend.available && formTrend.direction && formTrend.average !== null) {
    const windowLabel = `son ${formTrend.sampleSize} maç`;
    const directionText = formTrend.direction === "up"
      ? "yükselen bir eğri"
      : formTrend.direction === "down"
        ? "gerileyen bir eğri"
        : "dengeli bir seyir";
    sentences.push(`${windowLabel} ortalaması ${formTrend.average.toFixed(2)}; performans trendi ${directionText} gösteriyor.`);
    sources.push("form eğrisi");
  }

  const highlight = (metrics || [])
    .filter((metric) => metric.available && metric.benchmarkScore !== null && metric.group !== "disiplin")
    .sort((left, right) => right.benchmarkScore - left.benchmarkScore)[0];
  if (highlight && highlight.benchmarkScore >= 70) {
    const valueText = highlight.per90 === null ? highlight.display : `${formatNumber(highlight.per90, 2)} (90 dk)`;
    sentences.push(`${roleLabel} rolünde en güçlü çıktısı ${highlight.label.toLocaleLowerCase("tr-TR")}: ${valueText}.`);
    sources.push("pozisyon referans karşılaştırması");
  }

  if (recent && recent.available && recent.matches.length) {
    const window = recent.matches.length;
    const recentGoals = recent.matches.reduce((sum, match) => sum + (hasNumber(match.goals) ? Number(match.goals) : 0), 0);
    const recentAssists = recent.matches.reduce((sum, match) => sum + (hasNumber(match.assists) ? Number(match.assists) : 0), 0);
    if (recentGoals || recentAssists) {
      sentences.push(`Son ${window} maçta ${recentGoals} gol ve ${recentAssists} asistlik doğrudan katkı verdi.`);
      sources.push("son maç kayıtları");
    }
  }

  if (!sentences.length) {
    return {
      available: false,
      summary: null,
      sources: [],
      note: "Analiz özeti için performans verisi bekleniyor. Sağlayıcıdan maç istatistikleri geldiğinde bu alan otomatik dolar.",
      generatedFrom: null,
      method: "futbolradar-player-insight-v1"
    };
  }

  if (score && score.available) {
    sentences.push(`FutbolRadar Oyuncu Skoru ${score.value}/100 (${score.label}), veri güveni ${score.confidence.label.toLocaleLowerCase("tr-TR")}.`);
    sources.push("oyuncu skoru");
  }

  const written = sentences.map(sentenceCase);

  return {
    available: true,
    summary: written.join(" "),
    sentences: written,
    sources: Array.from(new Set(sources)),
    generatedFrom: `${Array.from(new Set(sources)).length} veri kümesi`,
    note: "Özet yalnızca doğrulanmış istatistiklerden üretilir; eksik veri tahminle doldurulmaz.",
    method: "futbolradar-player-insight-v1"
  };
}

function metricEvidence(metric) {
  if (!metric) {
    return null;
  }

  if (metric.per90 !== null) {
    return `${formatNumber(metric.per90, 2)} / 90 dk`;
  }

  return metric.display;
}

/**
 * Güçlü yönler ve geliştirilmesi gereken yönler; hem skor bileşenlerinden
 * hem de pozisyon referansına göre metriklerden türetilir. Her madde
 * dayandığı sayıyı taşır, böylece kullanıcı iddiayı doğrulayabilir.
 */
function buildStrengthsAndWeaknesses(context) {
  const { metrics, score, positionGroup } = context;
  const benchmarks = PER90_BENCHMARKS[positionGroup] || PER90_BENCHMARKS.midfielder;
  const scored = (metrics || [])
    .filter((metric) => metric.available && metric.benchmarkScore !== null && benchmarks[metric.key])
    .filter((metric) => metric.key !== "goalsConceded");

  const strengths = scored
    .filter((metric) => metric.benchmarkScore >= 72)
    .sort((left, right) => right.benchmarkScore - left.benchmarkScore)
    .slice(0, 4)
    .map((metric) => ({
      label: metric.label,
      detail: `Pozisyon referansının üzerinde: ${metricEvidence(metric)}`,
      value: metric.benchmarkScore,
      metric: metric.key
    }));

  const weaknesses = scored
    .filter((metric) => metric.benchmarkScore <= 52)
    .sort((left, right) => left.benchmarkScore - right.benchmarkScore)
    .slice(0, 4)
    .map((metric) => ({
      label: metric.label,
      detail: `Pozisyon referansının altında: ${metricEvidence(metric)}`,
      value: metric.benchmarkScore,
      metric: metric.key
    }));

  (score && Array.isArray(score.components) ? score.components : [])
    .filter((item) => item.available)
    .forEach((item) => {
      if (item.value >= 78 && strengths.length < 5) {
        strengths.push({ label: item.label, detail: `Skor bileşeni ${item.value}/100`, value: item.value, metric: `score:${item.key}` });
      }
      if (item.value <= 48 && weaknesses.length < 5) {
        weaknesses.push({ label: item.label, detail: `Skor bileşeni ${item.value}/100`, value: item.value, metric: `score:${item.key}` });
      }
    });

  return {
    strengths: {
      items: strengths,
      available: strengths.length > 0,
      note: strengths.length ? null : "Güçlü yön çıkarımı için pozisyona göre yeterli metrik yok."
    },
    weaknesses: {
      items: weaknesses,
      available: weaknesses.length > 0,
      note: weaknesses.length ? null : "Geliştirme alanı çıkarımı için pozisyona göre yeterli metrik yok."
    }
  };
}

function playerRatingValue(player) {
  const candidates = [player && player.overallRating, player && player.aiRating, player && player.rating];
  const found = candidates.find(hasNumber);
  return hasNumber(found) ? Number(found) : null;
}

/**
 * Rol uyumu. Sağlayıcı mevkileri kaba dört kovaya düşüyor (Goalkeeper,
 * Defender, Midfielder, Attacker); veri katmanındaki kürasyonlu kayıtlarda
 * ise "Sol kanat" gibi ince ayrım var ve bu "winger" grubuna çözülüyor.
 * Kanat ile forvet bu yüzden eşleşebilir sayılır, diğer gruplar birbirine
 * kapalıdır: kalecinin bir kanat oyuncusuna "benzer oyuncu" olarak
 * çıkması, rating ve kulüp kapı tarafından gizlendiğinde benzerlik skorunun
 * yaşa düşmesinden kaynaklanıyordu.
 */
const COMPATIBLE_GROUPS = { winger: ["forward"], forward: ["winger"] };

function groupsCompatible(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a || !b) {
    return false;
  }

  if (a === b) {
    return true;
  }

  return (COMPATIBLE_GROUPS[a] || []).includes(b);
}

function similarityScore(player, candidate) {
  if (!player || !candidate || player.id === candidate.id) {
    return -1;
  }

  // Rol uyumu ön koşul: uymuyorsa aday hiç sıralanmaz.
  if (!groupsCompatible(player.positionGroup, candidate.positionGroup)) {
    return -1;
  }

  const sameRole = normalizeText(player.positionGroup) === normalizeText(candidate.positionGroup) ? 40 : 0;
  const samePosition = normalizeText(player.position) === normalizeText(candidate.position) ? 12 : 0;
  const sameLeague = player.league && candidate.league && normalizeText(player.league) === normalizeText(candidate.league) ? 10 : 0;
  const playerRating = playerRatingValue(player);
  const candidateRating = playerRatingValue(candidate);
  const ratingCloseness = playerRating !== null && candidateRating !== null
    ? Math.max(0, 24 - Math.abs(playerRating - candidateRating) * 1.6)
    : 0;
  const ageDelta = hasNumber(player.computedAge || player.age) && hasNumber(candidate.computedAge || candidate.age)
    ? Math.abs(Number(player.computedAge || player.age) - Number(candidate.computedAge || candidate.age))
    : null;
  const ageCloseness = ageDelta === null ? 0 : Math.max(0, 10 - ageDelta * 1.5);
  const marketDelta = hasNumber(player.marketValueEur) && hasNumber(candidate.marketValueEur)
    ? Math.abs(Number(player.marketValueEur) - Number(candidate.marketValueEur)) / 1000000
    : null;
  const marketCloseness = marketDelta === null ? 0 : Math.max(0, 10 - marketDelta / 4);

  return round(sameRole + samePosition + sameLeague + ratingCloseness + ageCloseness + marketCloseness, 1);
}

function candidateSummary(candidate, reason, matchScore) {
  return {
    id: candidate.id,
    name: candidate.name,
    team: candidate.currentTeam || candidate.team || null,
    league: candidate.league || null,
    position: positionLabelTr(candidate.position) || null,
    positionGroup: candidate.positionGroup || null,
    age: candidate.computedAge || candidate.age || null,
    rating: playerRatingValue(candidate),
    marketValueEur: hasNumber(candidate.marketValueEur) ? Number(candidate.marketValueEur) : null,
    marketValue: candidate.marketValue || null,
    photo: candidate.photo || null,
    reason,
    matchScore: matchScore === undefined ? null : matchScore
  };
}

function buildSimilarPlayers(player, pool, limit) {
  const list = Array.isArray(pool) ? pool : [];
  const manual = Array.isArray(player && player.similarPlayers) ? player.similarPlayers : [];
  const manualMatches = manual
    .map((item) => {
      const found = list.find((candidate) => candidate.id === item.id || normalizeText(candidate.name) === normalizeText(item.name));
      return found ? candidateSummary(found, item.reason || "Manuel eşleştirme", null) : null;
    })
    .filter(Boolean);

  const scored = list
    .map((candidate) => ({ candidate, score: similarityScore(player, candidate) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, (limit || 4) + manualMatches.length)
    .map((item) => candidateSummary(item.candidate, "Rol, yaş, rating ve piyasa değeri yakınlığı", item.score));

  const merged = [];
  const seen = new Set();
  manualMatches.concat(scored).forEach((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  });

  const items = merged.slice(0, limit || 4);

  return {
    items,
    available: items.length > 0,
    note: items.length ? null : "Benzer oyuncu eşleştirmesi için karşılaştırılabilir kayıt bulunamadı."
  };
}

/**
 * Aynı mevkide öne çıkan alternatifler: aynı pozisyon grubunda, farklı
 * takımdaki en yüksek skorlu oyuncular. Skoru olmayan oyuncular listeye
 * girer ama sıralamada rating'e düşer.
 */
function buildAlternatives(player, pool, limit) {
  const list = Array.isArray(pool) ? pool : [];
  const group = normalizeText(player && player.positionGroup);
  const team = normalizeText(player && (player.currentTeam || player.team));
  const items = list
    .filter((candidate) => candidate.id !== player.id)
    .filter((candidate) => groupsCompatible(group, candidate.positionGroup))
    .filter((candidate) => normalizeText(candidate.currentTeam || candidate.team) !== team)
    .sort((left, right) => (playerRatingValue(right) || 0) - (playerRatingValue(left) || 0))
    .slice(0, limit || 4)
    .map((candidate) => candidateSummary(candidate, `${POSITION_LABELS[group] || "Aynı mevki"} alternatifi`, null));

  return {
    items,
    available: items.length > 0,
    note: items.length ? null : "Aynı mevkide karşılaştırılabilir alternatif kaydı henüz yok."
  };
}

/**
 * Transfer söylentileri. Veri katmanı yalnızca doğrulanmış transferleri
 * tutar (`status: "confirmed"`), bu yüzden söylenti listesi bilinçli olarak
 * boş döner; sayfa uydurma söylenti yerine boş durum gösterir.
 */
function buildTransferRumors(player, transfers) {
  const list = Array.isArray(transfers) ? transfers : [];
  const wantedId = normalizeText(player && player.id);
  const wantedName = normalizeText(player && player.name);
  const related = list.filter((transfer) => {
    return normalizeText(transfer.playerId) === wantedId || normalizeText(transfer.playerName) === wantedName;
  });
  const confirmed = related.filter((transfer) => normalizeText(transfer.status) === "confirmed");
  const rumors = related.filter((transfer) => normalizeText(transfer.status) && normalizeText(transfer.status) !== "confirmed");

  return {
    items: rumors.map((transfer) => ({
      id: transfer.id || null,
      date: transfer.date || null,
      fromTeam: transfer.fromTeam || null,
      toTeam: transfer.toTeam || null,
      status: transfer.status || null,
      reliability: transfer.reliability || transfer.confidence || null,
      source: transfer.sourceName || transfer.source || null,
      sourceUrl: transfer.sourceUrl || null,
      note: transfer.note || null
    })),
    confirmed: confirmed.map((transfer) => ({
      id: transfer.id || null,
      date: transfer.date || null,
      fromTeam: transfer.fromTeam || null,
      toTeam: transfer.toTeam || null,
      fee: transfer.fee || null,
      feeEur: hasNumber(transfer.feeEur) ? Number(transfer.feeEur) : null,
      type: transfer.type || null,
      source: transfer.sourceName || transfer.source || null,
      sourceUrl: transfer.sourceUrl || null
    })),
    available: rumors.length > 0,
    note: rumors.length
      ? null
      : "Doğrulanmamış transfer söylentisi yayınlanmaz. Bu alan yalnızca kaynağı işaretlenmiş söylenti verisi geldiğinde dolar."
  };
}

module.exports = {
  POSITION_LABELS,
  buildAlternatives,
  buildAnalysis,
  buildFormPoints,
  buildFormTrend,
  buildSimilarPlayers,
  buildStrengthsAndWeaknesses,
  buildTransferRumors,
  groupsCompatible,
  similarityScore,
  trendDirection
};
