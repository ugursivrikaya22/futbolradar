const { buildMatchReport } = require("../services/matchReportService");
const { evaluateReportStage, hasReportableCore } = require("../services/matchReportStages");
const { retryPlan } = require("../services/reportRetrySchedule");
const {
  enforceRateLimit,
  getQuery,
  normalizeText,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("./_utils");

const SOURCE = "FutbolRadar Rapor Durumu";

/**
 * VERİ KÜMESİ: data/matches.json — rapor boru hattının işlediği kayıtların
 * tamamı ve yalnızca onlar.
 *
 * Fikstür takvimiyle birleştirilmiş liste (mockProvider) BİLEREK kullanılmıyor:
 * yeniden deneme takvimini uygulayan betik (scripts/plan-post-match-retries.mjs)
 * ve boru hattını ölçen servis (services/brainService.js) bu dosyayı okuyor.
 * Uç daha geniş bir küme sunsaydı, hiçbir zaman kuyruğa girmeyecek maçlar için
 * "deneme sırası geldi" yazar ve panel gerçekleşmeyecek bir işi bekler hâle
 * gelirdi.
 *
 * `require` ile okunuyor: sunucusuz derlemeye yalnızca require edilen varlıklar
 * kopyalanır; fs ile okunsaydı işlev dosyayı üretimde hiç bulamazdı.
 */
const matchesData = require("../data/matches.json");

/** Dizi ya da {matches:[…]} sarmalayıcısı — kayıt her iki biçimde de duruyor. */
function readMatches() {
  if (Array.isArray(matchesData)) return matchesData;
  if (matchesData && Array.isArray(matchesData.matches)) return matchesData.matches;
  return null;
}

/**
 * DENEME DEFTERİ (data/report-retry-ledger.json).
 *
 * Defter bir maçın kaç kez denendiğini tutar; takvim kararını buna göre verir.
 * Defter henüz oluşmamış olabilir — plan betiği hiç koşmadıysa dosya yoktur.
 * Böyle bir durumda "0 deneme" yazmak ölçüm gibi görünürdü; oysa doğru cevap
 * "bilmiyoruz". Bu yüzden defterin durumu ayrı bir blokta, gerekçesiyle
 * bildiriliyor ve kayıtlardaki deneme sayısı sayı değil `null` oluyor.
 */
function readRetryLedger() {
  let ledger;
  try {
    // eslint-disable-next-line global-require
    ledger = require("../data/report-retry-ledger.json");
  } catch (error) {
    return {
      known: false,
      entries: {},
      state: {
        measured: false,
        source: "data/report-retry-ledger.json",
        reason: "deneme defteri yok: hiçbir maçın kaç kez denendiği bilinmiyor"
      }
    };
  }

  if (!ledger || typeof ledger.matches !== "object" || !ledger.matches) {
    return {
      known: false,
      entries: {},
      state: {
        measured: false,
        source: "data/report-retry-ledger.json",
        reason: "deneme defteri beklenen biçimde değil: matches alanı okunamadı"
      }
    };
  }

  return {
    known: true,
    entries: ledger.matches,
    state: {
      measured: true,
      source: "data/report-retry-ledger.json",
      tracked: Object.keys(ledger.matches).length,
      updatedAt: ledger.updatedAt || null
    }
  };
}

/** Dakika değerleri ondalık üretiliyor; alan adının birimi neyse o basılır. */
function minutes(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Skor biliniyor mu sorusunun cevabı matchReportStages'in.
 *
 * Burada ikinci bir "skor geçerli mi" kuralı yazılmıyor: iki yerde yaşayan
 * bir eşik bir gün ayrışır ve uç, raporun "veri yok" dediği maça skor basar.
 * Skor bilinmiyorsa alan `null` — 0-0 ile "bilinmiyor" aynı şey değildir.
 */
function scoreOf(match) {
  if (!hasReportableCore(match)) return null;
  return { home: Number(match.score.home), away: Number(match.score.away) };
}

/**
 * Tek maçın rapor durumu ve yeniden deneme planı.
 *
 * Her iki karar da servislerden okunuyor; bu fonksiyon yalnızca sonucu
 * yanıt biçimine çeviriyor.
 */
function toRecord(match, context) {
  const { now, ledger } = context;
  const entry = (ledger.known && ledger.entries[match && match.id]) || null;

  // Rapor, sayfaların basıldığı hattın kendisinden üretiliyor: panel ile
  // yayımlanan rapor sayfası aynı durumu göstersin diye.
  const report = buildMatchReport(match, { now, generatedAt: now.toISOString() });
  const stage = evaluateReportStage({ sections: (report && report.sections) || {}, match, now });
  const plan = retryPlan(match, {
    now,
    report,
    // Defter yoksa takvim her maçı ilk deneme sayar. Bu bir varsayımdır ve
    // `retry.recordedAttempts: null` ile birlikte okunmalıdır.
    attempts: entry ? entry.attempts : 0,
    lastAttemptAt: entry ? entry.lastAttemptAt : null
  });

  return {
    id: match.id || null,
    league: match.league || null,
    kickoff: match.kickoff || null,
    homeTeam: match.homeTeam || null,
    awayTeam: match.awayTeam || null,
    // Sağlayıcının durum etiketi ham hâliyle taşınıyor; kayıtta yoksa
    // uydurulmuyor. Raporun durumu buna değil, `report` bloğuna bakılarak
    // okunur — etiket saatler sonra gelebiliyor.
    providerStatus: match.status || null,
    score: scoreOf(match),
    report: {
      status: stage.status.key,
      label: stage.status.text,
      detail: stage.status.detail,
      tone: stage.status.tone,
      stage: stage.stage,
      // Rapor gerçekten üretildi mi: "durumu biliniyor" ile "sayfası var"
      // ayrı sorular.
      generated: Boolean(report),
      coverage: stage.coverage,
      minutesSinceFullTime: minutes(stage.ageMinutes)
    },
    retry: {
      action: plan.action,
      reason: plan.reason,
      dueInMinutes: minutes(plan.dueInMinutes),
      attempt: plan.attempt,
      priority: plan.priority,
      // Defter okunamadıysa sayı değil null: kaç kez denendiğini bilmiyoruz.
      recordedAttempts: ledger.known ? Number((entry && entry.attempts) || 0) : null,
      lastAttemptAt: (entry && entry.lastAttemptAt) || null
    },
    // Kaydın en son ne zaman doğrulandığı; yanıtın `updatedAt` alanı da
    // bu değerlerden türetiliyor.
    lastVerifiedAt: match.lastVerifiedAt || null
  };
}

/**
 * MAÇ RAPORU DURUMU UCU.
 *
 * `?match=<id>` verilirse tek maç, verilmezse kayıttaki her maç döner.
 *
 * Kendi eşiğini tanımlamaz: rapor durumu services/matchReportStages.js,
 * yeniden deneme planı services/reportRetrySchedule.js kararıdır. Uç yalnızca
 * bu kararları okur ve okunamayan her şeyi gerekçesiyle bildirir — bilinmeyen
 * bir değerin yerine sıfır yazılmaz.
 */
module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "report-status");
  // Her çağrı kayıttaki tüm maçların raporunu yeniden kuruyor; sınır bu
  // maliyeti gözeterek sayfa uçlarından dar tutuldu.
  if (enforceRateLimit(req, res, { limit: 60 })) return;

  const matches = readMatches();
  if (!matches) {
    return sendError(
      res,
      200,
      "Maç kaydı okunamadı: data/matches.json beklenen biçimde değil.",
      "MATCH_DATA_UNAVAILABLE",
      SOURCE
    );
  }

  const now = new Date();
  const ledger = readRetryLedger();

  let records;
  try {
    records = matches.map((match) => toRecord(match || {}, { now, ledger }));
  } catch (error) {
    return sendError(
      res,
      200,
      `Rapor durumu hesaplanamadı: ${error.message || "bilinmeyen hata"}`,
      "REPORT_STATUS_UNAVAILABLE",
      SOURCE
    );
  }

  const wanted = normalizeText(getQuery(req).match || "");
  const selected = wanted
    ? records.filter((record) => normalizeText(record.id) === wanted)
    : records;

  if (wanted && !selected.length) {
    // Var olmayan bir kimlik için boş liste dönmek, "bu maçın raporu yok"
    // gibi okunurdu. Sorun raporda değil, kimlikte.
    return sendError(
      res,
      200,
      "Bu kimlikle eşleşen maç kaydı bulunamadı.",
      "MATCH_NOT_FOUND",
      SOURCE
    );
  }

  return sendSuccess(res, selected, SOURCE, undefined, {
    generatedAt: now.toISOString(),
    source: "data/matches.json",
    // Süzgeç uygulandığında bile kümenin tamamı görünür kalsın: "1 kayıt"
    // ile "kayıtta 1 maç var" farklı cümleler.
    counts: { total: records.length, returned: selected.length },
    filter: { match: wanted || null },
    retryLedger: ledger.state
  });
};
