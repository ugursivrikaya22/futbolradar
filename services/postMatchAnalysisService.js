/**
 * MAÇ SONRASI ANALİZ KARTI — tamamlanan HER maç için.
 *
 * NEDEN AYRI BİR KATMAN: `matchReportService` tam rapor sayfasını üretiyor ve
 * yalnızca `data/matches.json` içindeki elle doğrulanmış kayıtlar için
 * çalıştırılıyordu. Sağlayıcı takviminden gelen (skoru bilinen ama olay/
 * istatistik dökümü olmayan) tamamlanmış maçlar hiçbir yüzeyde analiz
 * almıyordu; ana sayfadaki "Analizi hazır" sayacı bu yüzden 0 gösteriyordu.
 * Bu katman, kaynağı ne olursa olsun tamamlanmış her maç için tek biçimli bir
 * kart üretir.
 *
 * KARTIN SÖZLEŞMESİ — beş alan her zaman vardır, hiçbiri uydurulmaz:
 *   1. summary        — özet (doğrulanmış skor + gol olaylarından)
 *   2. turningPoint   — maçın kırılma anı (olay akışından)
 *   3. teamPerformance— takım performans notları (ölçülmüş istatistiklerden)
 *   4. coverage       — veri kapsamı: neyin ölçüldüğü VE neyin eksik olduğu
 *   5. confidence     — güven seviyesi (kapsamdan türetilir)
 *
 * EKSİK VERİ GİZLENMEZ, UYDURULMAZ. Bir alanın dayanağı yoksa `status`
 * `"unavailable"` olur ve `reason` neyin beklendiğini söyler. Kart yine
 * yayımlanır; `dataStatus === "insufficient"` ise başlığında açıkça "veri
 * yetersiz" etiketi taşır. Boş bir kart basmak ile uydurma bir kart basmak
 * arasında seçim yapmıyoruz: ölçülen ne varsa o yazılır, gerisi eksik ilan
 * edilir.
 */

const {
  buildSummary,
  buildMomentum,
  buildSignals,
  buildStatisticsAnalysis,
  buildTacticalRead,
  buildTurningPoints,
  buildAiRating,
  slug
} = require("./matchReportService");

const FINISHED_STATES = new Set(["FINISHED", "FT", "AET", "PEN"]);

/**
 * Kapsam bileşenleri. Her biri TEK bir ölçülebilir girdiye karşılık gelir;
 * ağırlıklar bileşenin analize kattığı bilgiyle ölçeklidir (skor olmadan
 * hiçbir okuma yapılamaz, istatistik dökümü ise en zengin girdidir).
 */
const COVERAGE_COMPONENTS = [
  { id: "score", label: "Kesin skor", weight: 3 },
  { id: "halftime", label: "İlk yarı skoru", weight: 1 },
  { id: "goals", label: "Gol dakikaları ve golcüler", weight: 2 },
  { id: "events", label: "Dakikalı olay akışı", weight: 2 },
  { id: "statistics", label: "Maç istatistikleri", weight: 4 },
  { id: "lineups", label: "Diziliş bilgisi", weight: 1 },
  { id: "rating", label: "Takım performans puanı", weight: 2 }
];

const TOTAL_COVERAGE_WEIGHT = COVERAGE_COMPONENTS.reduce((total, item) => total + item.weight, 0);

/**
 * Analitik okuma üretebilen çekirdek ölçüler. "İstatistik var mı?" sorusu
 * ikili sorulduğunda yalnızca sarı/kırmızı kart dökümü gelen bir maç, 26
 * ölçüsü olan maçla aynı kapsama sayılıyordu — kart sayısı hücum, savunma ya
 * da kontrol okuması üretemez. Kapsam bu yüzden çekirdek ölçülerin kaçının
 * geldiğine göre oranlanır.
 */
const CORE_STAT_TYPES = [
  "Topla oynama",
  "Toplam şut",
  "İsabetli şut",
  "Gol beklentisi (xG)",
  "Pas isabeti",
  "Korner"
];

const CONFIDENCE_LABELS = {
  high: "Yüksek",
  medium: "Orta",
  low: "Sınırlı",
  insufficient: "Veri yetersiz"
};

const DATA_STATUS_LABELS = {
  complete: "Veri tam",
  partial: "Veri kısmi",
  insufficient: "Veri yetersiz"
};

function isNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function isFinished(match) {
  return Boolean(match) && FINISHED_STATES.has(String(match.status || match.providerStatus || "").toUpperCase());
}

function minuteOf(event) {
  const raw = String((event && (event.time || event.minute)) || "").match(/\d+/g);
  if (!raw || !raw.length) return null;
  return raw.reduce((total, part) => total + Number(part), 0);
}

function goalEventCount(match) {
  return (Array.isArray(match.events) ? match.events : [])
    .filter((event) => /gol/i.test(String((event && event.type) || ""))).length;
}

function timedEventCount(match) {
  return (Array.isArray(match.events) ? match.events : [])
    .filter((event) => minuteOf(event) !== null).length;
}

/** Çekirdek ölçülerin kaçı iki taraf için de sayısal geldi (0..1). */
function coreStatRatio(match) {
  const rows = Array.isArray(match.statistics) ? match.statistics : [];
  if (!rows.length) return 0;
  const normalize = (value) => String(value || "").toLocaleLowerCase("tr-TR").trim();
  const present = CORE_STAT_TYPES.filter((type) => rows.some((row) => {
    return row && normalize(row.type) === normalize(type) && isNumber(row.home) && isNumber(row.away);
  })).length;
  return present / CORE_STAT_TYPES.length;
}

/**
 * Neyin ölçüldüğü ve neyin eksik olduğu. Yüzde, bileşen ağırlıklarına göre
 * hesaplanır — "7 bölümden 3'ü hazır" gibi düz bir sayım, skoru bilinen ama
 * istatistiği olmayan bir maçı olduğundan zengin gösteriyordu.
 *
 * Bileşen puanı 0 ile 1 arasındadır. İkili olmayan tek bileşen istatistik
 * dökümü: kısmen gelmiş bir döküm kısmi puan alır, "var" sayılmaz.
 */
function computeCoverage(match, sections) {
  const score = match.score || {};
  const hasScore = isNumber(score.home) && isNumber(score.away);
  const goalsMeasured = goalEventCount(match) > 0 ||
    // Gerçekten golsüz biten maçta gol verisi EKSİK değil: 0-0 doğrulanmış
    // bir ölçümdür ve özet bunu olduğu gibi yazar.
    (hasScore && Number(score.home) === 0 && Number(score.away) === 0);
  const statRatio = coreStatRatio(match);

  const scores = {
    score: hasScore ? 1 : 0,
    halftime: isNumber(score.halftimeHome) && isNumber(score.halftimeAway) ? 1 : 0,
    goals: goalsMeasured ? 1 : 0,
    events: timedEventCount(match) >= 2 ? 1 : 0,
    statistics: statRatio,
    lineups: (Array.isArray(match.lineups) ? match.lineups : []).some((row) => row && row.formation) ? 1 : 0,
    // Performans puanı "hazır" görünse bile tek dayanağı skor farkıysa
    // ölçülmüş sayılmaz: `buildAiRating` istatistik yokluğunda gol marjına
    // düşüyor ve o marj skor bileşeninde zaten sayılmıştır.
    rating: sections.aiRating.status === "ready" && Number(sections.aiRating.confidence) > 0 ? 1 : 0
  };

  const measured = [];
  const missing = [];
  const partial = [];
  let earned = 0;

  for (const component of COVERAGE_COMPONENTS) {
    const value = scores[component.id];
    earned += component.weight * value;
    if (value >= 1) measured.push(component.label);
    else if (value > 0) partial.push(component.label);
    else missing.push(component.label);
  }

  const components = {};
  for (const component of COVERAGE_COMPONENTS) {
    components[component.id] = scores[component.id] > 0;
  }
  // Skor bileşeni her okumanın önkoşulu: kısmi değil, ikili.
  components.score = hasScore;

  return {
    percent: Math.round((earned / TOTAL_COVERAGE_WEIGHT) * 100),
    measured,
    partial,
    missing,
    measuredCount: measured.length,
    totalCount: COVERAGE_COMPONENTS.length,
    components,
    scores
  };
}

/**
 * Güven seviyesi kapsamdan türetilir; ayrı bir "model güveni" iddiası yok.
 * Skor doğrulanmadıysa hiçbir okuma yapılamaz: seviye doğrudan
 * "insufficient" olur.
 */
function computeConfidence(coverage) {
  if (!coverage.components.score) {
    return { level: "insufficient", label: CONFIDENCE_LABELS.insufficient, score: 0 };
  }
  const level = coverage.percent >= 70 ? "high" : coverage.percent >= 40 ? "medium" : "low";
  return { level, label: CONFIDENCE_LABELS[level], score: coverage.percent };
}

function resolveDataStatus(coverage) {
  if (!coverage.components.score) return "insufficient";
  if (coverage.percent >= 70) return "complete";
  if (coverage.percent >= 40) return "partial";
  return "insufficient";
}

/** Özet: doğrulanmış skor ve gol olaylarından. Skor yoksa üretilmez. */
function analysisSummary(match, sections) {
  const summary = sections.summary;
  if (summary.status !== "ready") {
    return {
      status: "unavailable",
      reason: summary.reason || "Maç sonucu henüz doğrulanmadı; özet ancak kesin skorla yazılır."
    };
  }
  return {
    status: "ready",
    headline: summary.headline,
    text: summary.paragraph,
    basis: "Doğrulanmış skor ve gol olayları"
  };
}

/**
 * Maçın kırılma anı: olay akışındaki en ağırlıklı tek an (kırmızı kart >
 * penaltı > gol > direk > kurtarış). Olay akışı yoksa an uydurulmaz.
 */
function analysisTurningPoint(match, sections) {
  const turning = sections.turningPoints;
  if (turning.status === "unavailable" || !Array.isArray(turning.moments) || !turning.moments.length) {
    return {
      status: "unavailable",
      reason: turning.reason ||
        `${match.homeTeam} - ${match.awayTeam} maçının olay akışı doğrulanmadığı için kırılma anı belirlenemiyor.`
    };
  }

  // Belirleyici (gol/penaltı/kırmızı) anlar varsa aralarından ilki seçilir;
  // yoksa akıştaki ilk an "kırılma" diye sunulmaz, "öne çıkan an" olur.
  const pivotal = turning.moments.filter((moment) => moment.pivotal);
  const chosen = pivotal.length ? pivotal[0] : turning.moments[0];
  const detail = String(chosen.detail || "").trim();
  const teamPart = chosen.team ? ` ${chosen.team}` : "";

  return {
    status: pivotal.length ? "ready" : "partial",
    minute: chosen.minute,
    team: chosen.team || null,
    type: chosen.type,
    detail,
    pivotal: Boolean(chosen.pivotal),
    text: detail
      ? `${chosen.minute}${teamPart} · ${chosen.type}: ${detail}`
      : `${chosen.minute}${teamPart} · ${chosen.type}`,
    moments: turning.moments,
    basis: "Sağlayıcı olay akışı"
  };
}

/**
 * Takım performans notları. Her not tek bir ölçüme dayanır ve dayanağını
 * (`basis`) taşır: dayanağı yazılamayan bir not üretilmez.
 */
function analysisTeamPerformance(match, sections) {
  const notes = { home: [], away: [] };
  const shared = [];

  const rating = sections.aiRating;
  const ratingBySide = { home: null, away: null };
  if (rating.status === "ready") {
    for (const side of ["home", "away"]) {
      const entry = rating[side];
      if (entry && isNumber(entry.score)) {
        ratingBySide[side] = { score: entry.score, team: entry.team };
        notes[side].push({
          text: `Performans puanı ${entry.score}/100.`,
          basis: "Ölçülmüş istatistiklerden hesaplanan takım puanı"
        });
      }
    }
  }

  const signals = sections.signals;
  if (signals.status === "ready" && Array.isArray(signals.signals)) {
    for (const signal of signals.signals) {
      const side = signal.team === match.homeTeam ? "home" : signal.team === match.awayTeam ? "away" : null;
      if (!side || !signal.metric) continue;
      notes[side].push({
        // Sinyalin cümlesi ölçünün adı ve iki taraflı değeriyle kurulur;
        // "üstün" gibi bir nitelik yalnızca fark ölçüldüğü için yazılabilir.
        text: `${signal.label}: ${signal.metric} ${signal.value} ile önde${signal.strong ? " (belirgin üstünlük)" : ""}.`,
        basis: `Ölçülmüş istatistik · ${signal.metric}`
      });
    }
  }

  if (sections.statistics.status === "ready") {
    for (const reading of sections.statistics.readings || []) {
      shared.push({ text: reading, basis: "Maç istatistikleri" });
    }
  }

  if (sections.tactical.status !== "unavailable") {
    for (const note of sections.tactical.notes || []) {
      const side = note.startsWith(String(match.homeTeam))
        ? "home"
        : note.startsWith(String(match.awayTeam))
          ? "away"
          : null;
      if (side) notes[side].push({ text: note, basis: "Diziliş ve oyun yapısı verisi" });
      else shared.push({ text: note, basis: "Diziliş ve oyun yapısı verisi" });
    }
  }

  const momentum = sections.momentum;
  if (momentum.status === "ready") {
    const leaders = (momentum.phases || []).filter((phase) => phase.leader);
    for (const phase of leaders) {
      const side = phase.leader === match.homeTeam ? "home" : "away";
      notes[side].push({
        text: `${phase.label} diliminde olay üretiminde önde (${Math.max(phase.home, phase.away)}-${Math.min(phase.home, phase.away)}).`,
        basis: `Dakikalı olay akışı · ${momentum.sampleSize} olay`
      });
    }
  }

  const total = notes.home.length + notes.away.length + shared.length;
  if (!total) {
    return {
      status: "unavailable",
      reason: `${match.homeTeam} ve ${match.awayTeam} için istatistik, diziliş ve dakikalı olay verisi doğrulanmadı; ` +
        "performans notu yalnızca ölçülmüş veriden yazılır."
    };
  }

  return {
    // Tek taraflı veri "hazır" sayılmaz: iki takımın da okunabildiği durumda
    // rapor dengeli, aksi halde kısmidir.
    status: notes.home.length && notes.away.length ? "ready" : "partial",
    home: { team: match.homeTeam, rating: ratingBySide.home, notes: notes.home.slice(0, 4) },
    away: { team: match.awayTeam, rating: ratingBySide.away, notes: notes.away.slice(0, 4) },
    shared: shared.slice(0, 4),
    noteCount: total
  };
}

function scoreLine(match) {
  const score = match.score || {};
  return isNumber(score.home) && isNumber(score.away) ? `${score.home}-${score.away}` : null;
}

function reportPath(match) {
  if (match.analysisPage) return match.analysisPage;
  const date = String(match.kickoff || "").slice(0, 10);
  if (!match.homeTeam || !match.awayTeam || !date) return null;
  return `mac-raporu/${slug(match.homeTeam)}-${slug(match.awayTeam)}-${date}.html`;
}

/**
 * Tamamlanan bir maç için analiz kartı. Maç tamamlanmadıysa `null` döner —
 * maç sonrası okuma yalnızca bitmiş maç için anlamlıdır.
 *
 * @param {object} match  data/matches.json veya sağlayıcı takvimi kaydı
 * @param {object} [options]
 * @param {string[]} [options.publishedReports] Yayımlanmış rapor yolları;
 *        yalnızca gerçekten var olan bir sayfaya bağlantı verilir.
 * @param {string} [options.generatedAt] Deterministik çıktı için zaman damgası.
 */
function buildPostMatchAnalysisCard(match, options) {
  if (!isFinished(match)) return null;

  const settings = options || {};
  const seed = String(match.id || `${match.homeTeam}-${match.awayTeam}`)
    .split("")
    .reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 100000, 7);

  const sections = {
    summary: buildSummary(match, seed),
    momentum: buildMomentum(match),
    signals: buildSignals(match),
    statistics: buildStatisticsAnalysis(match, seed),
    tactical: buildTacticalRead(match),
    turningPoints: buildTurningPoints(match),
    aiRating: buildAiRating(match)
  };

  const coverage = computeCoverage(match, sections);
  const confidence = computeConfidence(coverage);
  const dataStatus = resolveDataStatus(coverage);
  const path = reportPath(match);
  const published = Array.isArray(settings.publishedReports) ? settings.publishedReports : null;
  const hasReportPage = Boolean(path) && (!published || published.includes(path));

  const score = match.score || {};

  return {
    matchId: match.id || null,
    slug: match.id || (path ? path.replace(/^mac-raporu\//, "").replace(/\.html$/, "") : null),
    league: match.league || null,
    competitionId: match.competitionId || null,
    stage: match.stage || null,
    kickoff: match.kickoff || null,
    date: String(match.kickoff || "").slice(0, 10) || null,
    venue: match.venue || null,
    homeTeam: match.homeTeam || null,
    awayTeam: match.awayTeam || null,
    score: {
      home: isNumber(score.home) ? Number(score.home) : null,
      away: isNumber(score.away) ? Number(score.away) : null,
      halftimeHome: isNumber(score.halftimeHome) ? Number(score.halftimeHome) : null,
      halftimeAway: isNumber(score.halftimeAway) ? Number(score.halftimeAway) : null
    },
    scoreLine: scoreLine(match),
    summary: analysisSummary(match, sections),
    turningPoint: analysisTurningPoint(match, sections),
    teamPerformance: analysisTeamPerformance(match, sections),
    coverage,
    confidence,
    dataStatus,
    dataStatusLabel: DATA_STATUS_LABELS[dataStatus],
    insufficientData: dataStatus === "insufficient",
    reportUrl: hasReportPage ? path : null,
    source: match.source || match.dataStatus || null,
    generatedAt: settings.generatedAt || null
  };
}

/** Aynı maçın iki kaynakta da bulunması için kimlik anahtarı. */
function analysisIdentityKey(match) {
  const normalize = (value) => String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "");
  const pair = [normalize(match && match.homeTeam), normalize(match && match.awayTeam)].sort();
  return `${pair[0]}|${pair[1]}|${String((match && match.kickoff) || "").slice(0, 10)}`;
}

/**
 * Birden çok kaynaktan tamamlanmış maçları toplar ve her biri için kart
 * üretir. İlk kaynak önceliklidir (kürasyonlu kayıt sağlayıcı kaydını yener),
 * ancak sağlayıcı kaydında olup kürasyonlu kayıtta olmayan alanlar (skor gibi)
 * tamamlayıcı olarak alınır — aksi halde iki kaynağın birleşimi tek başına
 * her birinden daha zayıf olurdu.
 *
 * @param {object[][]} sources Öncelik sırasına göre maç listeleri.
 * @param {object} [options]
 */
function buildPostMatchAnalyses(sources, options) {
  const byKey = new Map();

  for (const list of sources || []) {
    for (const match of Array.isArray(list) ? list : []) {
      if (!isFinished(match)) continue;
      const key = analysisIdentityKey(match);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, match);
        continue;
      }
      // Kürasyonlu kayıt kalır; yalnızca onda hiç olmayan skor alanları
      // sağlayıcıdan doldurulur.
      const merged = { ...existing };
      const existingScore = existing.score || {};
      const incomingScore = match.score || {};
      if (!isNumber(existingScore.home) && isNumber(incomingScore.home)) {
        merged.score = { ...existingScore, ...incomingScore };
      }
      byKey.set(key, merged);
    }
  }

  return [...byKey.values()]
    .map((match) => buildPostMatchAnalysisCard(match, options))
    .filter(Boolean)
    .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")));
}

module.exports = {
  COVERAGE_COMPONENTS,
  CONFIDENCE_LABELS,
  DATA_STATUS_LABELS,
  analysisIdentityKey,
  buildPostMatchAnalyses,
  buildPostMatchAnalysisCard,
  computeCoverage,
  computeConfidence,
  isFinished,
  resolveDataStatus
};
