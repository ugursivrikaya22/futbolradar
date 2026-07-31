/**
 * MAÇ HATTI TEŞHİSİ — "sistem şu anda ne durumda?" sorusunun tek cevabı.
 *
 * Sağlık ucu (api/health.js) bugüne kadar yalnızca SAĞLAYICI yapılandırmasını
 * raporluyordu: anahtar var mı, lig kimliği çözülmüş mü. Bunlar hattın
 * çalışıp çalışmadığını söylemiyor. Bir kesinti sırasında sorulan sorular
 * şunlar:
 *
 *   - Son başarılı senkron ne zamandı?
 *   - Bugün kaç maç var, kaçı canlı?
 *   - Kaç tamamlanmış maç analiz bekliyor?
 *   - Kaç analiz tamam, kaçı kısmi, kaçı başarısız?
 *   - Veri ne kadar taze?
 *
 * Hepsi burada, saf fonksiyonlarda hesaplanıyor: uç nokta yalnızca çağırıyor,
 * böylece aynı özet komut satırından da alınabiliyor ve test edilebiliyor.
 *
 * GİZLİ BİLGİ SIZDIRMAZ. Bu modül ortam değişkeni okumaz; yalnızca maç ve
 * analiz verisi üzerinden sayım yapar.
 */

const { isAnalyzableStatus, isLiveStatus, isUnplayedStatus, liveVerdict, matchState } = require("./matchStatus");
const { dataCompleteness, refreshTier } = require("./refreshPolicy");
const { ANALYSIS_STATUSES } = require("./postMatchReportStore");

function istanbulToday(nowMs) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(Number.isFinite(nowMs) ? nowMs : Date.now()));
}

function dayOf(match) {
  return String((match && (match.kickoff || match.date)) || "").slice(0, 10);
}

function newestTimestamp(matches, field) {
  let newest = null;
  for (const match of matches || []) {
    const value = match && match[field];
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) continue;
    if (newest === null || parsed > newest) newest = parsed;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/** Tazelik: son başarılı senkrondan bu yana geçen dakika. */
function freshnessOf(lastSyncIso, nowMs) {
  if (!lastSyncIso) {
    return { lastSuccessfulSyncAt: null, ageMinutes: null, state: "unknown" };
  }

  const parsed = Date.parse(lastSyncIso);
  if (Number.isNaN(parsed)) {
    return { lastSuccessfulSyncAt: lastSyncIso, ageMinutes: null, state: "unknown" };
  }

  const ageMinutes = Math.round(((Number.isFinite(nowMs) ? nowMs : Date.now()) - parsed) / 60000);

  // Eşikler canlı iş döngüsüne (5 dakika) göre: iki döngü kaçırılmışsa
  // "gecikmiş", bir saat geçmişse "bayat".
  let state = "fresh";
  if (ageMinutes > 60) state = "stale";
  else if (ageMinutes > 15) state = "lagging";

  return { lastSuccessfulSyncAt: lastSyncIso, ageMinutes, state };
}

/**
 * Maç ve analiz durumunun tam özeti.
 *
 * @param {{matches: Array, reports: Array, nowMs: number}} input
 */
function buildPipelineDiagnostics(input) {
  const settings = input || {};
  const nowMs = Number.isFinite(settings.nowMs) ? settings.nowMs : Date.now();
  const matches = Array.isArray(settings.matches) ? settings.matches : [];
  const reports = Array.isArray(settings.reports) ? settings.reports : [];
  const today = istanbulToday(nowMs);

  const todaysMatches = matches.filter((match) => dayOf(match) === today);
  const live = matches.filter((match) => liveVerdict(match, { nowMs }).live);
  // Başlama saati geçmiş ama doğrulanamayan maçlar ayrı sayılır: bunlar
  // "canlı" değil, sağlayıcının veri vermediği maçlardır ve bir kesintinin
  // ilk görünür işaretidir.
  const unverified = matches.filter((match) => liveVerdict(match, { nowMs }).verdict === "unverified");
  const finished = matches.filter(isAnalyzableStatus);
  const unplayed = matches.filter(isUnplayedStatus);

  const reportsById = new Map(reports.map((record) => [record.matchId, record]));
  const analysisCounts = reports.reduce((acc, record) => {
    const status = record.analysisStatus || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const awaitingAnalysis = finished.filter((match) => {
    const record = reportsById.get(match.id);
    return !record ||
      record.analysisStatus === ANALYSIS_STATUSES.WAITING ||
      record.analysisStatus === ANALYSIS_STATUSES.READY ||
      record.analysisStatus === ANALYSIS_STATUSES.RETRY;
  });

  const lastSync = newestTimestamp(matches, "lastSuccessfulSyncAt") || newestTimestamp(matches, "providerSyncedAt");

  const tierCounts = matches.reduce((acc, match) => {
    const tier = refreshTier(match, { nowMs });
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});

  const completenessValues = finished.map((match) => dataCompleteness(match));
  const averageCompleteness = completenessValues.length
    ? Math.round((completenessValues.reduce((sum, value) => sum + value, 0) / completenessValues.length) * 100) / 100
    : null;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    timezone: "Europe/Istanbul",
    today,
    matches: {
      total: matches.length,
      today: todaysMatches.length,
      live: live.length,
      // Doğrulanamayan: kick-off geçti, sağlayıcı canlı demiyor. Canlı
      // SAYILMAZ; arayüz "canlı veri doğrulanamadı" gösterir.
      unverifiedLive: unverified.length,
      finished: finished.length,
      unplayed: unplayed.length,
      byState: matches.reduce((acc, match) => {
        const state = matchState(match);
        acc[state] = (acc[state] || 0) + 1;
        return acc;
      }, {})
    },
    refreshTiers: tierCounts,
    analysis: {
      stored: reports.length,
      awaiting: awaitingAnalysis.length,
      awaitingIds: awaitingAnalysis.slice(0, 10).map((match) => match.id),
      completed: analysisCounts[ANALYSIS_STATUSES.COMPLETED] || 0,
      partial: analysisCounts[ANALYSIS_STATUSES.PARTIAL] || 0,
      failed: analysisCounts[ANALYSIS_STATUSES.FAILED] || 0,
      retryScheduled: analysisCounts[ANALYSIS_STATUSES.RETRY] || 0,
      byStatus: analysisCounts,
      // Üretim hatası veren maçlar sessizce kaybolmaz.
      errors: reports
        .filter((record) => record.analysisError)
        .slice(0, 10)
        .map((record) => ({ matchId: record.matchId, status: record.analysisStatus, error: record.analysisError }))
    },
    freshness: {
      ...freshnessOf(lastSync, nowMs),
      providerUpdatedAt: newestTimestamp(matches, "providerUpdatedAt"),
      averageDataCompleteness: averageCompleteness
    }
  };
}

module.exports = {
  buildPipelineDiagnostics,
  freshnessOf,
  istanbulToday
};
