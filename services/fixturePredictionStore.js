/**
 * TAHMİN DEPOSU — sayfa açıldığında hesaplanan değil, ÖNCEDEN hazırlanmış
 * tahmin.
 *
 * NEDEN DEPO. Maç detay sayfası her görüntülemede `/predictions` ya da
 * `/odds` çağırsaydı, ücretsiz paketin günlük 100 isteği tek bir popüler
 * maçta biterdi ve kota bittiğinde yalnızca tahmin değil CANLI SKOR da
 * dururdu (bkz. services/requestBudget.js). Tahmin bu yüzden derleme /
 * zamanlanmış koşu anında üretilir, dosyaya yazılır, sayfa dosyadan okur.
 *
 * ---------------------------------------------------------------------
 * TAZELEME BASAMAKLARI
 * ---------------------------------------------------------------------
 * Tahmin maça yaklaştıkça değerlenir: sağlayıcı modelini günceller, oran
 * hareket eder, kadro belli olur. Ama her koşuda her maçı yeniden sormak
 * kotayı yakar. Bu yüzden sabit basamaklar var — her basamak fikstür
 * başına EN FAZLA bir kez sorulur:
 *
 *   T-72s → T-24s → T-6s → T-90dk
 *
 * Kayıt, içinde bulunduğu basamağı taşır (`refreshStage`) ve bir sonraki
 * basamağın başlangıcında geçersizleşir (`expiresAt`). Aynı basamakta
 * ikinci kez istek YOK.
 *
 * ---------------------------------------------------------------------
 * BAŞLAYAN MAÇIN TAHMİNİ DONAR
 * ---------------------------------------------------------------------
 * İlk düdükten sonra maç öncesi tahmin bir daha DEĞİŞMEZ (`frozen`).
 * Sebep dürüstlük: 2-0 öndeyken "ev sahibi %78" yazmak, tahmini sonuca
 * göre geriye dönük düzeltmek olur. Donmuş kayıt, tahminin maçtan önce
 * gerçekten ne dediğinin kanıtıdır — `data/prediction-performance.json`
 * doğruluk ölçümü de buna dayanır.
 */

const fs = require("node:fs");
const path = require("node:path");

const STORE_VERSION = 1;

/** Tazeleme basamakları — maça kalan saate göre, en gevşekten en sıkıya. */
const REFRESH_STAGES = Object.freeze([
  { id: "T-72h", hoursBefore: 72 },
  { id: "T-24h", hoursBefore: 24 },
  { id: "T-6h", hoursBefore: 6 },
  { id: "T-90m", hoursBefore: 1.5 }
]);

/** 72 saatten uzak maç: henüz sıraya girmedi. */
const STAGE_SCHEDULED = "scheduled";
/** Başlamış maç: tahmin donmuştur. */
const STAGE_KICKED_OFF = "kickoff";

const HOUR_MS = 60 * 60 * 1000;

function toMs(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Zaman girdisi Date, ISO metni ya da EPOCH SAYISI olabilir.
 * Sayı hâli özellikle önemli: `needsRefresh` kendi çözdüğü anı
 * `refreshStageFor`a sayı olarak geçiriyordu ve `Date.parse(sayı)` NaN
 * döndüğü için basamak sessizce "şimdi"den hesaplanıyordu — yani kayıt
 * tazeyken bile tazelenmesi gerektiği söyleniyordu ve her koşu aynı
 * fikstüre yeniden istek atardı. Kota tam olarak buradan sızardı.
 */
function nowMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "number" && Number.isFinite(now)) return now;
  const parsed = toMs(now);
  return parsed === null ? Date.now() : parsed;
}

/** Maça kalan süreye göre içinde bulunulan basamak. */
function refreshStageFor(kickoff, now) {
  const kickoffMs = toMs(kickoff);
  const reference = nowMs(now);
  if (kickoffMs === null) return STAGE_SCHEDULED;
  if (reference >= kickoffMs) return STAGE_KICKED_OFF;
  const hoursToKickoff = (kickoffMs - reference) / HOUR_MS;
  const entered = REFRESH_STAGES.filter((stage) => stage.hoursBefore >= hoursToKickoff);
  if (!entered.length) return STAGE_SCHEDULED;
  return entered.reduce((tightest, stage) => (stage.hoursBefore < tightest.hoursBefore ? stage : tightest)).id;
}

/**
 * Kaydın geçerlilik sonu: bir sonraki (daha sıkı) basamağın başlangıcı.
 * En sıkı basamaktan sonra sınır maçın kendisidir — başlayan maçta kayıt
 * zaten donar.
 */
function expiresAtFor(kickoff, now) {
  const kickoffMs = toMs(kickoff);
  if (kickoffMs === null) return null;
  const stage = refreshStageFor(kickoff, now);
  if (stage === STAGE_KICKED_OFF) return new Date(kickoffMs).toISOString();
  const index = stage === STAGE_SCHEDULED ? -1 : REFRESH_STAGES.findIndex((entry) => entry.id === stage);
  const next = REFRESH_STAGES[index + 1];
  const boundary = next ? kickoffMs - next.hoursBefore * HOUR_MS : kickoffMs;
  return new Date(boundary).toISOString();
}

/**
 * Bu fikstür için yeniden hesaplama/istek gerekiyor mu?
 *
 * Donmuş (maç başlamış) kayıt asla tazelenmez. Basamak değiştiyse ya da
 * kaydın süresi dolduysa tazelenir. Aynı basamakta ikinci istek YOK —
 * kota tam olarak burada korunuyor.
 */
function needsRefresh(record, kickoff, now) {
  const reference = nowMs(now);
  const kickoffMs = toMs(kickoff);
  if (kickoffMs !== null && reference >= kickoffMs) return false;
  if (!record) return true;
  if (record.frozen) return false;
  const stage = refreshStageFor(kickoff, reference);
  if (record.refreshStage !== stage) return true;
  const expires = toMs(record.expiresAt);
  return expires === null ? true : reference >= expires;
}

/** Maç başladıysa kaydı dondurur; başlamadıysa olduğu gibi döner. */
function freezeIfStarted(record, kickoff, now) {
  if (!record) return record;
  const kickoffMs = toMs(kickoff);
  if (kickoffMs === null || nowMs(now) < kickoffMs) return record;
  if (record.frozen) return record;
  return { ...record, frozen: true, frozenAt: new Date(nowMs(now)).toISOString() };
}

/**
 * Çözülmüş olasılığı kalıcı kayıt biçimine çevirir. Alan adları
 * `supabase/migrations/0004_fixture_predictions.sql` ile birebir aynı
 * kavramları taşır; iki yerde farklı adlandırmak, göç ile kodun sessizce
 * ayrışmasının bilinen yoludur.
 */
function buildRecord(options = {}) {
  const { fixture, resolved, now } = options;
  if (!fixture || !resolved || !resolved.probabilities) return null;
  const calculatedAt = new Date(nowMs(now)).toISOString();
  const stage = refreshStageFor(fixture.kickoff, now);

  return {
    fixtureId: fixture.id || null,
    providerFixtureId: fixture.providerFixtureId || null,
    competitionId: fixture.competitionId || null,
    leagueId: fixture.leagueId || null,
    season: fixture.season || null,
    kickoff: fixture.kickoff || null,
    homeTeam: fixture.homeTeam || null,
    awayTeam: fixture.awayTeam || null,
    homeTeamId: fixture.homeTeamId || null,
    awayTeamId: fixture.awayTeamId || null,

    source: resolved.source,
    homeProbability: resolved.probabilities.home,
    drawProbability: resolved.probabilities.draw,
    awayProbability: resolved.probabilities.away,
    predictedWinner: resolved.predictedWinner || null,
    advice: resolved.advice || null,
    underOver: resolved.underOver || null,
    predictedGoals: resolved.predictedGoals || null,
    comparison: resolved.comparison || null,
    confidence: resolved.confidence === undefined ? null : resolved.confidence,

    modelVersion: resolved.modelVersion || null,
    expectedGoals: resolved.expectedGoals || null,
    modelUnderOver: resolved.modelUnderOver || null,
    bothTeamsScore: resolved.bothTeamsScore === undefined ? null : resolved.bothTeamsScore,
    marketConsensus: resolved.source === "market_probability"
      ? {
        bookmakerCount: resolved.bookmakerCount || 0,
        bookmakers: resolved.bookmakers || [],
        method: resolved.consensusMethod || null,
        averageMargin: resolved.averageMargin === undefined ? null : resolved.averageMargin
      }
      : null,
    modelInputs: resolved.inputs || null,
    fallbackChain: resolved.fallbackChain || [],

    providerUpdatedAt: resolved.providerUpdatedAt || null,
    calculatedAt,
    expiresAt: expiresAtFor(fixture.kickoff, now),
    refreshStage: stage,
    frozen: stage === STAGE_KICKED_OFF
  };
}

function emptyStore() {
  return { version: STORE_VERSION, updatedAt: null, predictions: [] };
}

function readStore(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.predictions)) return emptyStore();
    return { version: parsed.version || STORE_VERSION, updatedAt: parsed.updatedAt || null, predictions: parsed.predictions };
  } catch {
    return emptyStore();
  }
}

/** Atomik yazma: yarım yazılmış bir JSON, derlemeyi tamamen durdurur. */
function writeStore(filePath, store) {
  const payload = {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    predictionCount: store.predictions.length,
    predictions: store.predictions
      .slice()
      .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)) ||
        String(left.fixtureId).localeCompare(String(right.fixtureId)))
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
  return payload;
}

/** Kaydı fikstür kimliğine göre ekler ya da yerinde günceller. */
function upsertRecord(store, record) {
  if (!record || !record.fixtureId) return store;
  const index = store.predictions.findIndex((entry) => entry.fixtureId === record.fixtureId);
  if (index === -1) store.predictions.push(record);
  else store.predictions[index] = record;
  return store;
}

/**
 * Hızlı arama dizini. Sayfa üretimi 661 maç için tek tek tarama yapmasın
 * diye hem doğal kimlik hem sağlayıcı fikstür kimliği anahtarlanır.
 */
function indexStore(store) {
  const byFixtureId = new Map();
  const byProviderId = new Map();
  for (const record of (store && Array.isArray(store.predictions) ? store.predictions : [])) {
    if (record.fixtureId) byFixtureId.set(String(record.fixtureId), record);
    if (record.providerFixtureId) byProviderId.set(String(record.providerFixtureId), record);
  }
  return {
    byFixtureId,
    byProviderId,
    find(fixtureId, providerFixtureId) {
      if (providerFixtureId && byProviderId.has(String(providerFixtureId))) return byProviderId.get(String(providerFixtureId));
      if (fixtureId && byFixtureId.has(String(fixtureId))) return byFixtureId.get(String(fixtureId));
      return null;
    }
  };
}

/** Depolanan kayıttan arayüzün beklediği olasılık nesnesini kurar. */
function toDisplayRecord(record) {
  if (!record) return null;
  const home = Number(record.homeProbability);
  const draw = Number(record.drawProbability);
  const away = Number(record.awayProbability);
  if (![home, draw, away].every(Number.isFinite)) return null;
  return {
    source: record.source,
    probabilities: { home, draw, away },
    predictedWinner: record.predictedWinner || null,
    advice: record.advice || null,
    underOver: record.underOver || null,
    predictedGoals: record.predictedGoals || null,
    comparison: record.comparison || null,
    confidence: record.confidence === undefined ? null : record.confidence,
    expectedGoals: record.expectedGoals || null,
    modelUnderOver: record.modelUnderOver || null,
    bothTeamsScore: record.bothTeamsScore === undefined ? null : record.bothTeamsScore,
    marketConsensus: record.marketConsensus || null,
    calculatedAt: record.calculatedAt || null,
    providerUpdatedAt: record.providerUpdatedAt || null
  };
}

module.exports = {
  STORE_VERSION,
  REFRESH_STAGES,
  STAGE_SCHEDULED,
  STAGE_KICKED_OFF,
  refreshStageFor,
  expiresAtFor,
  needsRefresh,
  freezeIfStarted,
  buildRecord,
  emptyStore,
  readStore,
  writeStore,
  upsertRecord,
  indexStore,
  toDisplayRecord
};
