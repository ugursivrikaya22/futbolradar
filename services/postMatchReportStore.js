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

const { buildMatchReport, meetsFullReportThreshold } = require("./matchReportService");
const { buildPostMatchIntelligence } = require("./postMatchIntelligence");
const {
  PROVIDER_MISSING_LABEL,
  finishLabel,
  finishType,
  isAnalyzableMatch,
  isAwardedStatus,
  matchState
} = require("./matchStatus");
const { dataCompleteness, hasCompleteMatchData } = require("./refreshPolicy");
const { GRADES, buildCoverage } = require("./analysisCoverage");
const { resolveProviderMode } = require("./providerMode");
const { isTurkishMatch, turkishSideOf } = require("./turkishTeams");

/**
 * Üretim mantığının sürümü. Rapor servislerinde içerik üreten bir değişiklik
 * yapıldığında ARTIRILMALI; yoksa parmak izi eşleşmeye devam eder ve eski
 * raporlar yeniden üretilmez.
 */
// v5: olay okuma iki biçimi de tanıyor. Sağlayıcı kayıtlarında golcü adı
// `value` alanında; v4 yalnızca `detail`e baktığı için golcü "Normal Goal"
// diye yazılıyor ve sağlayıcıdan gelen kırmızı kartlar kırılma anlarına
// hiç girmiyordu (167 yayınlanmış sayfa etkilendi).
// v6: `publishState` artık üçlü. v5 yalnızca "ölçülmüş bir bölüm var mı"
// diye soruyordu; skoru bilinen ama golcüsü/dakikası/olay akışı olmayan
// maçlar (ör. Trabzonspor 5-0 Gençlerbirliği) bu yüzden TAM RAPOR
// sayılıyordu. Artık "page" yalnızca asgari eşik (skor + golcü/dakika ya da
// resmi olay listesi) geçildiğinde; eşik altındaki maçlar "summary-card".
const MODEL_VERSION = "futbolradar-post-match-v6";

/**
 * ANALİZ YAŞAM DÖNGÜSÜ.
 *
 * Bir maçın analizi tek adımda "var/yok" değildir: sağlayıcı veriyi son
 * düdükten dakikalar sonra yayımlıyor, üretim başarısız olabiliyor ve
 * başarısız bir üretim maçı kalıcı olarak dışarıda bırakmamalı.
 *
 *   waiting_for_final_data — maç bitti, sağlayıcı verisi henüz yetersiz.
 *   ready_for_analysis     — yeterli doğrulanmış veri var, üretim sırada.
 *   generating             — üretim sürüyor (koşu içi geçici durum).
 *   completed              — analiz üretildi ve veri tam sayılıyor.
 *   partial_data           — analiz üretildi ama sağlayıcı bazı alanları
 *                            hiç vermedi; arayüz bunu açıkça işaretler.
 *   failed                 — üretim hata verdi, deneme hakkı kalmadı.
 *   retry_scheduled        — üretim hata verdi, yeniden denenecek.
 */
const ANALYSIS_STATUSES = Object.freeze({
  WAITING: "waiting_for_final_data",
  READY: "ready_for_analysis",
  GENERATING: "generating",
  COMPLETED: "completed",
  PARTIAL: "partial_data",
  FAILED: "failed",
  RETRY: "retry_scheduled"
});

/**
 * YAYIN DURUMU — sayfa hangi biçimde basılır.
 *
 *   page          — asgari veri eşiği geçildi (skor + golcü/dakika ya da
 *                    resmi olay listesi): tam rapor sayfası.
 *   summary-card  — skor doğrulandı ama eşik altında: kısa sonuç kartı
 *                    (skor, lig, stadyum, saat). Aynı URL, veri gelince
 *                    "page"e yükselir.
 *   store-only    — ölçülmüş tek bölüm yok (skor bile yok): bağımsız sayfa
 *                    basılmaz, analiz yalnızca depoda durur.
 */
const PUBLISH_STATES = Object.freeze({
  PAGE: "page",
  SUMMARY_CARD: "summary-card",
  STORE_ONLY: "store-only"
});

/** Bir maç için en fazla kaç kez üretim denenir. */
const MAX_ANALYSIS_ATTEMPTS = 3;

/** Başarısız denemeden sonra beklenecek süre (üstel geri çekilme tabanı). */
const RETRY_BACKOFF_MS = 10 * 60 * 1000;

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
    firstHalf: sections.firstHalf
      ? { status: sections.firstHalf.status, notes: trimMoments(sections.firstHalf.notes, 6), goals: sections.firstHalf.goals || 0 }
      : null,
    secondHalf: sections.secondHalf
      ? { status: sections.secondHalf.status, notes: trimMoments(sections.secondHalf.notes, 6), goals: sections.secondHalf.goals || 0 }
      : null,
    coaching: sections.coaching
      ? {
        status: sections.coaching.status,
        notes: trimMoments(sections.coaching.notes, 6),
        formations: sections.coaching.formations || [],
        interpretation: sections.coaching.interpretation || null
      }
      : null,
    finalAssessment: sections.finalAssessment && sections.finalAssessment.status !== "unavailable"
      ? {
        status: sections.finalAssessment.status,
        verdict: trimMoments(sections.finalAssessment.verdict, 3),
        strengths: trimMoments(sections.finalAssessment.strengths, 3),
        improvements: trimMoments(sections.finalAssessment.improvements, 3),
        closing: sections.finalAssessment.closing || null,
        basis: sections.finalAssessment.basis || null
      }
      : null,
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
 * Europe/Istanbul yerel zaman gösterimi.
 *
 * Sunucunun yerel saat dilimine GÜVENİLMEZ: CI ubuntu-latest üzerinde UTC,
 * Vercel fonksiyonu UTC, geliştirici makinesi başka bir dilim olabilir.
 * Zaman damgaları UTC saklanır, okuyucuya TSİ gösterilir ve dönüşüm her
 * zaman açıkça `timeZone: "Europe/Istanbul"` ile yapılır.
 */
function istanbulLocal(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Istanbul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(parsed).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function utcIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Kazanan takım — yalnızca doğrulanmış skordan. Uydurulmaz. */
function winnerOf(match) {
  const score = match && match.score;
  if (!score || typeof score.home !== "number" || typeof score.away !== "number") return null;
  if (score.home > score.away) return match.homeTeam || null;
  if (score.away > score.home) return match.awayTeam || null;
  return "draw";
}

/**
 * Analiz durumu — üretim sonucundan türetilir.
 *
 * Hükmen sonuçlar (AWD/WO) kaçınılmaz olarak `partial_data`: maç sahada
 * oynanmadığı için olay ve istatistik yoktur ve olmayacaktır.
 */
function analysisStatusFor(match, report, availability) {
  if (isAwardedStatus(match)) {
    return ANALYSIS_STATUSES.PARTIAL;
  }

  const ready = readySectionIds(report);

  if (!ready.length) {
    // Hiçbir bölüm ölçülmüş veriye dayanmıyor: sağlayıcı henüz veri
    // vermemiş olabilir. Bu maç analiz kuyruğunda kalır.
    return ANALYSIS_STATUSES.WAITING;
  }

  return hasCompleteMatchData(match) && !availability.missing.length
    ? ANALYSIS_STATUSES.COMPLETED
    : ANALYSIS_STATUSES.PARTIAL;
}

/**
 * Tek maç için depo kaydı üretir. `null` döner: maç analiz edilebilir
 * değilse (bitmemiş ya da oynanmayacak).
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
  const generatedAt = settings.generatedAt || null;
  const previous = settings.previous || null;
  const analysisStatus = analysisStatusFor(match, report, availability);
  // Anahtar durumu çağrı bağlamından gelir; gelmezse ortamdan okunur.
  const apiKeyPresent = settings.apiKeyPresent !== undefined
    ? settings.apiKeyPresent
    : resolveProviderMode().apiKeyPresent;
  const coverage = buildCoverage(match, { apiKeyPresent, provider: match.liveStateSource || null });
  const kickoffRaw = match.kickoff || match.date || null;

  return {
    // ── Kimlik ──────────────────────────────────────────────────────────
    matchId: match.id,
    // Sağlayıcı fikstür kimliği YETKİLİ tekil anahtardır; aynı karşılaşma
    // iki kaynaktan farklı yerel id ile gelebiliyor.
    fixtureId: (match.providerIds && match.providerIds["api-football"]) || match.providerId || match.fixtureId || null,
    provider: match.liveStateSource || (match.providerIds ? "api-football" : "curated"),
    slug: report.seo.path.replace(/^mac-raporu\//, "").replace(/\.html$/, ""),

    // ── Zaman: UTC saklanır, TSİ gösterilir ─────────────────────────────
    kickoff: kickoffRaw,
    kickoffUtc: utcIso(kickoffRaw),
    kickoffLocal: istanbulLocal(kickoffRaw),
    date: String(kickoffRaw || "").slice(0, 10),

    // ── Maç ─────────────────────────────────────────────────────────────
    status: matchState(match),
    providerStatus: match.providerStatus || match.status || null,
    finishType: finishType(match),
    finishLabel: finishLabel(match),
    league: match.league || null,
    competition: report.seo.competition || match.league || null,
    competitionType: match.competitionType || null,
    season: match.season || null,
    homeTeam: match.homeTeam || null,
    awayTeam: match.awayTeam || null,
    venue: match.venue || null,
    score: availability.hasScore ? { home: match.score.home, away: match.score.away } : null,
    finalScore: availability.hasScore ? `${match.score.home}-${match.score.away}` : null,
    winner: winnerOf(match),
    turkish: isTurkishMatch(match),
    turkishTeam: turkishSideOf(match),

    // ── Kapsam ve kaynak ────────────────────────────────────────────────
    // Rozet ("Tam analiz" / "Kısmi analiz" / "Sadece olaylar" /
    // "Sağlayıcı verisi bekleniyor" / "API anahtarı eksik") ve hangi alanı
    // hangi kaynağın sağladığı. Düşük kapsam süslenmez.
    coverageGrade: coverage.grade,
    coverageLabel: coverage.label,
    coverageNote: coverage.note,
    coveragePercent: coverage.percent,
    dataSources: coverage.sources,
    apiKeyPresent: coverage.apiKeyPresent,

    // ── Veri tazeliği ───────────────────────────────────────────────────
    availability: availability.counts,
    dataCompleteness: dataCompleteness(match),
    providerUpdatedAt: match.providerUpdatedAt || null,
    lastSuccessfulSyncAt: match.lastSuccessfulSyncAt || match.providerSyncedAt || null,
    missingInputs: availability.missing,
    providerMissingLabel: PROVIDER_MISSING_LABEL,

    // ── Analiz yaşam döngüsü ────────────────────────────────────────────
    analysisStatus,
    analysisVersion: MODEL_VERSION,
    modelVersion: MODEL_VERSION,
    analysisSourceHash: analysisFingerprint(match),
    fingerprint: analysisFingerprint(match),
    analysisGeneratedAt: (previous && previous.analysisGeneratedAt) || generatedAt,
    analysisUpdatedAt: generatedAt,
    generatedAt,
    analysisError: null,
    analysisAttempts: previous ? Number(previous.analysisAttempts || 0) : 0,

    // ── İçerik ──────────────────────────────────────────────────────────
    seo: report.seo,
    reportUrl: `./${report.seo.path}`,
    digest: digestOf(report, intelligence),
    readySections: ready,
    coverage: report.coverage,
    dataStatus: report.dataStatus,
    intelligenceCoverage: intelligence.coverage,

    // Bağımsız bir sayfa yalnızca ölçülmüş en az bir bölüm varsa basılır —
    // tamamen boş bir sayfa okuyucuya da arama motoruna da değer vermez.
    // Ölçülmüş bir bölüm VARSA ama asgari eşik (skor + golcü/dakika ya da
    // resmi olay listesi) geçilmediyse sayfa yine basılır, sadece TAM RAPOR
    // değil kısa sonuç kartı olarak — "5-0 ama golcüsüz tam rapor" hatası
    // burada önlenir. Analiz her durumda depoda durur; eksik veri açıkça
    // yazılarak gösterilir.
    publishState: !ready.length
      ? PUBLISH_STATES.STORE_ONLY
      : (meetsFullReportThreshold(match, report) ? PUBLISH_STATES.PAGE : PUBLISH_STATES.SUMMARY_CARD)
  };
}

/**
 * Başarısız üretimi kaydeder. Maç KALICI olarak dışarıda bırakılmaz:
 * deneme hakkı varsa `retry_scheduled`, bittiyse `failed` olur ve iki
 * durumda da sebep kayıtta kalır.
 */
function markAnalysisFailure(match, error, context) {
  const settings = context || {};
  const attempts = Number((settings.previous && settings.previous.analysisAttempts) || 0) + 1;
  const canRetry = attempts < MAX_ANALYSIS_ATTEMPTS;
  const generatedAt = settings.generatedAt || new Date().toISOString();

  return {
    ...(settings.previous || {}),
    matchId: match.id,
    homeTeam: match.homeTeam || null,
    awayTeam: match.awayTeam || null,
    kickoff: match.kickoff || match.date || null,
    date: String(match.kickoff || match.date || "").slice(0, 10),
    turkish: isTurkishMatch(match),
    analysisStatus: canRetry ? ANALYSIS_STATUSES.RETRY : ANALYSIS_STATUSES.FAILED,
    analysisAttempts: attempts,
    analysisError: String((error && error.message) || error || "bilinmeyen hata").slice(0, 300),
    analysisUpdatedAt: generatedAt,
    // Üstel geri çekilme: arka arkaya aynı hatayı almak kotayı ve günlüğü
    // boşa harcar.
    retryAfter: canRetry
      ? new Date(Date.parse(generatedAt) + RETRY_BACKOFF_MS * (2 ** (attempts - 1))).toISOString()
      : null,
    analysisVersion: MODEL_VERSION,
    publishState: PUBLISH_STATES.STORE_ONLY
  };
}

/** Bu kayıt şimdi yeniden denenmeli mi? */
function isRetryDue(record, nowMs) {
  if (!record || record.analysisStatus !== ANALYSIS_STATUSES.RETRY) return false;
  if (!record.retryAfter) return true;
  const due = Date.parse(record.retryAfter);
  return Number.isNaN(due) || due <= (Number.isFinite(nowMs) ? nowMs : Date.now());
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
  // Anahtar durumu koşu başına BİR kez çözülür: aynı koşuda bazı kayıtların
  // "anahtar var", bazılarının "yok" demesi tutarsız olurdu.
  const apiKeyPresent = settings.apiKeyPresent !== undefined
    ? settings.apiKeyPresent
    : resolveProviderMode().apiKeyPresent;

  const records = [];
  const stats = {
    total: analyzable.length,
    created: 0,
    reused: 0,
    regenerated: 0,
    failed: 0,
    byStatus: {},
    errors: []
  };

  for (const match of analyzable) {
    const fingerprint = analysisFingerprint(match);
    const existing = previousById.get(match.id);

    // Parmak izi aynı VE önceki koşu başarılıysa kayıt korunur. Başarısız
    // ya da yeniden denenmeyi bekleyen kayıt, girdisi değişmese de tekrar
    // denenir — aksi hâlde geçici bir hata kalıcı olurdu.
    const stale = existing && (existing.analysisStatus === ANALYSIS_STATUSES.FAILED ||
      isRetryDue(existing, Date.parse(generatedAt)) ||
      // Anahtar geldi/gitti: rozet değişmeli, kayıt yeniden üretilmeli.
      (existing.apiKeyPresent !== undefined && existing.apiKeyPresent !== apiKeyPresent));

    if (existing && !stale && existing.fingerprint === fingerprint && existing.modelVersion === MODEL_VERSION) {
      records.push(existing);
      stats.reused += 1;
      stats.byStatus[existing.analysisStatus] = (stats.byStatus[existing.analysisStatus] || 0) + 1;
      continue;
    }

    // Üretim hatası maçı KALICI olarak dışarıda bırakmaz: hata kayda
    // yazılır, deneme hakkı varsa yeniden denenmek üzere işaretlenir.
    let record = null;
    try {
      record = buildReportRecord(match, { ...context, generatedAt, previous: existing, apiKeyPresent });
    } catch (error) {
      const failure = markAnalysisFailure(match, error, { previous: existing, generatedAt });
      records.push(failure);
      stats.failed += 1;
      stats.errors.push({ matchId: match.id, error: failure.analysisError, status: failure.analysisStatus });
      continue;
    }

    if (!record) {
      stats.failed += 1;
      continue;
    }

    records.push(record);
    stats.byStatus[record.analysisStatus] = (stats.byStatus[record.analysisStatus] || 0) + 1;
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
  ANALYSIS_STATUSES,
  GRADES,
  MAX_ANALYSIS_ATTEMPTS,
  MODEL_VERSION,
  PROVIDER_MISSING_LABEL,
  PUBLISH_STATES,
  RETRY_BACKOFF_MS,
  TRACKED_INPUTS,
  analysisFingerprint,
  analysisStatusFor,
  buildReportRecord,
  digestOf,
  inputAvailability,
  isRetryDue,
  istanbulLocal,
  markAnalysisFailure,
  orderForDisplay,
  readySectionIds,
  syncPostMatchReports,
  winnerOf
};
