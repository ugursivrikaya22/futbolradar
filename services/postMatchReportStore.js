/**
 * MAÇ SONRASI ANALİZ DEPOSU — "bir kez üret, sakla, her yerde göster".
 *
 * SORUN. Rapor bugüne kadar yalnızca build sırasında hesaplanıp doğrudan
 * `mac-raporu/*.html` içine gömülüyordu. Analiz hiçbir yerde VERİ olarak
 * durmadığı için maç detay sayfası, günlük analiz sayfası ve ana sayfa onu
 * okuyamıyordu — üç yüzey de aynı analizi gösteremiyordu.
 *
 * ÇÖZÜM. Tamamlanmış her maç için okunabilir bir özet kaydı
 * `data/post-match-reports.json` dosyasında tutulur. Sunum katmanları bu
 * dosyayı okur; analiz tek yerde üretilir, üç yüzeyde aynı görünür.
 *
 * PARMAK İZİ (fingerprint) — "bir kez üret" bunun üzerine kurulu. Kayıt,
 * analizi besleyen girdilerin (durum, skor, olaylar, istatistikler,
 * kadrolar) özetini taşır. Sonraki koşuda parmak izi aynıysa rapor YENİDEN
 * ÜRETİLMEZ, mevcut kayıt aynen korunur. Bunun iki faydası var:
 *
 *   1. Üretim gerçekten bir kez oluyor; her build aynı işi tekrarlamıyor.
 *   2. `generatedAt` sabit kalıyor. Aksi hâlde her CI koşusu bütün
 *      raporların zaman damgasını değiştirir ve depo, içeriği değişmemiş
 *      yüzlerce satırlık gürültülü diff'lerle dolardı.
 *
 * MODEL SÜRÜMÜ parmak izine dahildir: üretim mantığı değiştiğinde sürüm
 * artırılır ve bütün raporlar bir sonraki koşuda yeniden üretilir. Sürümü
 * artırmadan mantığı değiştirmek, eski raporların sonsuza kadar donmasına
 * yol açar.
 *
 * UYDURMA YOK. Kayıt yalnızca rapor servislerinin ölçülmüş veriden ürettiği
 * bölümleri taşır. Sağlayıcı bir alanı vermediğinde bölüm kayda "eksik"
 * olarak girer ve arayüz PROVIDER_MISSING_LABEL metnini gösterir; sahte
 * değer, sıfır ya da örnek veri yazılmaz.
 */

const crypto = require("node:crypto");

const { buildMatchReport } = require("./matchReportService");
const { buildPostMatchIntelligence } = require("./postMatchIntelligence");
const { PROVIDER_MISSING_LABEL, finishLabel, finishType, isAnalyzableMatch } = require("./matchStatus");
const { isTurkishMatch, turkishSideOf } = require("./turkishTeams");

/**
 * Üretim mantığının sürümü. Rapor servislerinde içerik üreten bir değişiklik
 * yapıldığında ARTIRILMALI; yoksa parmak izi eşleşmeye devam eder ve eski
 * raporlar yeniden üretilmez.
 */
const MODEL_VERSION = "futbolradar-post-match-v1";

/** Sağlayıcıdan beklenen ve tek tek izlenen veri alanları. */
const TRACKED_INPUTS = [
  ["events", "Olay akışı"],
  ["statistics", "Maç istatistikleri"],
  ["lineups", "Kadrolar"],
  ["players", "Oyuncu istatistikleri"]
];

function countOf(match, field) {
  const value = match && match[field];
  return Array.isArray(value) ? value.length : 0;
}

/** Sağlayıcının bu maç için ne verdiği — sayımlar ve eksik alan listesi. */
function inputAvailability(match) {
  const counts = {};
  const missing = [];

  for (const [field, label] of TRACKED_INPUTS) {
    const count = countOf(match, field);
    counts[field] = count;
    if (!count) missing.push({ field, label });
  }

  const hasScore = Boolean(match && match.score &&
    typeof match.score.home === "number" && typeof match.score.away === "number");

  if (!hasScore) missing.push({ field: "score", label: "Maç skoru" });

  return { counts, missing, hasScore };
}

/**
 * Analizi besleyen girdilerin parmak izi. Yalnızca analize giren alanlar
 * dahildir: kartın görünümünü değiştirmeyen bir alan (ör. `providerVenue`)
 * değiştiğinde rapor gereksiz yere yeniden üretilmemeli.
 */
function analysisFingerprint(match) {
  const payload = JSON.stringify({
    model: MODEL_VERSION,
    id: match.id || null,
    home: match.homeTeam || null,
    away: match.awayTeam || null,
    kickoff: match.kickoff || match.date || null,
    league: match.league || null,
    venue: match.venue || null,
    status: match.status || null,
    providerStatus: match.providerStatus || null,
    score: match.score || null,
    events: match.events || [],
    statistics: match.statistics || [],
    lineups: match.lineups || [],
    players: match.players || []
  });

  return crypto.createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

function trimMoments(moments, limit) {
  return (Array.isArray(moments) ? moments : []).slice(0, limit);
}

/**
 * Depoya girecek özet. Tam rapor (istatistik tabloları, momentum evreleri)
 * `mac-raporu/*.html` sayfasında kalır; burada sunum yüzeylerinin ihtiyaç
 * duyduğu okunabilir çekirdek tutulur, çünkü bu dosyayı tarayıcı indiriyor.
 */
function digestOf(report, intelligence) {
  const sections = report.sections || {};
  const summary = sections.summary || {};
  const tactical = sections.tactical || {};

  return {
    headline: summary.status === "ready" ? summary.headline : null,
    paragraph: summary.status === "ready" ? summary.paragraph : null,
    result: summary.status === "ready" ? summary.result : null,
    finish: sections.finish || null,
    turningPoints: {
      status: (sections.turningPoints || {}).status || "unavailable",
      moments: trimMoments((sections.turningPoints || {}).moments, 5)
    },
    lateGame: sections.lateGame
      ? {
        status: sections.lateGame.status,
        from: sections.lateGame.from,
        verdict: sections.lateGame.verdict || null,
        goals: sections.lateGame.goals || null,
        moments: trimMoments(sections.lateGame.moments, 4)
      }
      : null,
    keyPlayers: {
      status: (sections.standoutPlayers || {}).status || "unavailable",
      players: trimMoments((sections.standoutPlayers || {}).players, 4)
    },
    tactical: {
      status: tactical.status || "unavailable",
      notes: trimMoments(tactical.notes, 6)
    },
    aiRating: sections.aiRating && sections.aiRating.status === "ready"
      ? { home: sections.aiRating.home, away: sections.aiRating.away, confidence: sections.aiRating.confidence }
      : null,
    // Ölçülmüş analiz bölümleri: başlık + okuma cümleleri. Metrik tabloları
    // rapor sayfasında kalır, depoyu şişirmesin.
    analysis: (intelligence.sections || []).map((section) => ({
      id: section.id,
      title: section.title,
      readings: trimMoments(section.readings, 3),
      confidence: section.confidence || null
    })),
    analysisOmitted: intelligence.omitted || []
  };
}

/** Bölümlerden kaçı gerçekten ölçülmüş veriye dayanıyor? */
function readySectionIds(report) {
  return Object.entries(report.sections || {})
    .filter(([key, section]) => key !== "finish" && section && section.status === "ready")
    .map(([key]) => key);
}

/**
 * Tek maç için depo kaydı üretir. `null` döner: maç analiz edilebilir
 * değilse (bitmemiş ya da hükmen).
 */
function buildReportRecord(match, context) {
  if (!isAnalyzableMatch(match)) {
    return null;
  }

  const settings = context || {};
  const report = buildMatchReport(match, settings);

  if (!report) {
    return null;
  }

  const intelligence = buildPostMatchIntelligence(match);
  const availability = inputAvailability(match);
  const ready = readySectionIds(report);

  return {
    matchId: match.id,
    slug: report.seo.path.replace(/^mac-raporu\//, "").replace(/\.html$/, ""),
    kickoff: match.kickoff || match.date || null,
    date: String(match.kickoff || match.date || "").slice(0, 10),
    league: match.league || null,
    competitionType: match.competitionType || null,
    homeTeam: match.homeTeam || null,
    awayTeam: match.awayTeam || null,
    score: availability.hasScore ? { home: match.score.home, away: match.score.away } : null,
    status: "FINISHED",
    providerStatus: match.providerStatus || match.status || null,
    finishType: finishType(match),
    finishLabel: finishLabel(match),
    turkish: isTurkishMatch(match),
    turkishTeam: turkishSideOf(match),
    modelVersion: MODEL_VERSION,
    fingerprint: analysisFingerprint(match),
    generatedAt: settings.generatedAt || null,
    seo: report.seo,
    reportUrl: `./${report.seo.path}`,
    digest: digestOf(report, intelligence),
    availability: availability.counts,
    // Sağlayıcının hiç vermediği alanlar. Arayüz bunları
    // PROVIDER_MISSING_LABEL ile gösterir; boş bırakmaz.
    missingInputs: availability.missing,
    providerMissingLabel: PROVIDER_MISSING_LABEL,
    readySections: ready,
    coverage: report.coverage,
    dataStatus: report.dataStatus,
    intelligenceCoverage: intelligence.coverage,
    // Bağımsız bir rapor SAYFASI yalnızca ölçülmüş en az bir bölüm varsa
    // basılır. Tamamen boş bir sayfa okuyucuya da arama motoruna da değer
    // vermez; analiz yine de depoda durur ve maç detay/analiz sayfalarında
    // eksik veri açıkça yazılarak gösterilir.
    publishState: ready.length ? "page" : "store-only"
  };
}

/**
 * Tüm tamamlanmış maçlar için depoyu günceller.
 *
 * Parmak izi değişmeyen kayıt AYNEN korunur — yeniden üretilmez. Dönen
 * sayımlar, koşunun gerçekte ne yaptığını günlüğe yazmak içindir.
 *
 * @param {{matches: Array, previous: Array, generatedAt: string, context: Object}} options
 */
function syncPostMatchReports(options) {
  const settings = options || {};
  const matches = Array.isArray(settings.matches) ? settings.matches : [];
  const previous = Array.isArray(settings.previous) ? settings.previous : [];
  const generatedAt = settings.generatedAt || new Date().toISOString();
  const context = settings.context || {};

  const previousById = new Map(previous.map((record) => [record.matchId, record]));
  const analyzable = matches.filter(isAnalyzableMatch);

  const records = [];
  const stats = { total: analyzable.length, created: 0, reused: 0, regenerated: 0, failed: 0 };

  for (const match of analyzable) {
    const fingerprint = analysisFingerprint(match);
    const existing = previousById.get(match.id);

    if (existing && existing.fingerprint === fingerprint && existing.modelVersion === MODEL_VERSION) {
      records.push(existing);
      stats.reused += 1;
      continue;
    }

    const record = buildReportRecord(match, { ...context, generatedAt });

    if (!record) {
      stats.failed += 1;
      continue;
    }

    records.push(record);
    if (existing) stats.regenerated += 1;
    else stats.created += 1;
  }

  // En yeni maç önce: hem analiz sayfası hem ana sayfa bu sırayı kullanıyor.
  records.sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")));

  return { records, stats };
}

/**
 * Sunum sırası: bitmiş TÜRK takımı maçları önce, sonra en yeni maç.
 * Ana sayfa ve analiz sayfası bu sırayı paylaşır.
 */
function orderForDisplay(records) {
  return (Array.isArray(records) ? records.slice() : []).sort((left, right) => {
    const turkishGap = Number(Boolean(right.turkish)) - Number(Boolean(left.turkish));
    if (turkishGap !== 0) return turkishGap;
    return String(right.kickoff || "").localeCompare(String(left.kickoff || ""));
  });
}

module.exports = {
  MODEL_VERSION,
  PROVIDER_MISSING_LABEL,
  TRACKED_INPUTS,
  analysisFingerprint,
  buildReportRecord,
  digestOf,
  inputAvailability,
  orderForDisplay,
  readySectionIds,
  syncPostMatchReports
};
