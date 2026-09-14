const { getProvider, mockProvider } = require("../services/providers");
const probabilityStore = require("../services/fixturePredictionStore.js");
const probabilityService = require("../services/fixtureProbabilityService.js");
const { quotesForMatch } = require("../services/managerQuotes");
const managerQuoteStore = require("../data/manager-quotes.json");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess,
  setCachePolicy,
  validateMatchDetail,
  validateOrSend,
  withTimeout
} = require("./_utils");

/** Depo bir kez okunur; işlev örneği boyunca bellekte kalır. */
let probabilityIndex = null;
function probabilityLookup() {
  if (!probabilityIndex) {
    probabilityIndex = probabilityStore.indexStore(loadProbabilityStore());
  }
  return probabilityIndex;
}

/**
 * Depoyu `require` ile okur — çalışma anında `fs` ile DEĞİL.
 *
 * Sunucusuz işlev paketine hangi dosyaların gireceğine derleyicinin statik
 * izleyicisi karar veriyor: `require("../data/...json")` izleniyor,
 * `fs.readFileSync(path.join(process.cwd(), ...))` izlenmiyor. İkincisiyle
 * dosya pakete girmez, okuma sessizce boş depo döndürür ve tahmin
 * ÜRETİMDE hiç görünmezdi — yerelde çalıştığı için de fark edilmezdi.
 * Bu depodaki diğer API yolları (transfers, match-analyses, manager-quotes)
 * aynı gerekçeyle `require` kullanıyor.
 *
 * `fs` yolu yalnızca yedek: depo dosyası henüz üretilmemişse (ilk kurulum)
 * `require` patlar ve boş depoyla devam edilir — tahmin alanı `null` kalır,
 * uydurma değer üretilmez.
 */
function loadProbabilityStore() {
  try {
    const store = require("../data/fixture-predictions.json");
    if (store && Array.isArray(store.predictions)) return store;
  } catch {
    /* Dosya yoksa aşağıdaki yedek yol denenir. */
  }
  try {
    const path = require("node:path");
    return probabilityStore.readStore(path.join(process.cwd(), "data", "fixture-predictions.json"));
  } catch {
    return probabilityStore.emptyStore();
  }
}

/**
 * Maç detayına, üç kaynaklı zincirin çözdüğü olasılığı ekler.
 *
 * Depoda kayıt yoksa ve sağlayıcı yükü elde varsa (canlı/ bitmiş maçta
 * çağıran taraf tahmin istemişse) o normalleştirilir. Hiçbiri yoksa alan
 * `null` kalır — istemci boş kutu değil, dürüst bir "yayımlanmadı" notu
 * çizer. UYDURMA YOK.
 */
function attachProbability(detail) {
  const stored = probabilityLookup().find(detail.id, detail.fixtureId || detail.providerId);
  const record = (stored && probabilityStore.toDisplayRecord(stored)) ||
    probabilityService.normalizeProviderPrediction(detail.prediction);
  if (!record || !probabilityService.isDisplayable(record)) {
    detail.probability = null;
    return;
  }
  const display = probabilityService.displayFor(record.source, "tr");
  detail.probability = {
    source: record.source,
    title: display.title,
    icon: display.icon,
    note: display.note,
    home: record.probabilities.home,
    draw: record.probabilities.draw,
    away: record.probabilities.away,
    advice: record.advice || null,
    predictedWinner: record.predictedWinner || null,
    calculatedAt: record.calculatedAt || null
  };
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "match-detail");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  // The permanent match-day page must see kick-off and full time without
  // serving the scheduled response from stale-while-revalidate CDN storage.
  if (String(query.fixtureId || '') === '1635659' || query.id === 'fenerbahce-roma-2026-09-10') {
    setCachePolicy(res, "match-detail-live");
  }
  const provider = getProvider("match-detail");
  // SAYFA GÖRÜNTÜLEMESİ TAHMİN İSTEĞİ TETİKLEMEZ. `/predictions` çağrısı
  // zamanlanmış koşuya ait; burada depo okunur (aşağıda `attachProbability`).
  // Kota tek bir popüler maçın trafiğiyle tükenmemeli.
  const detailQuery = { ...query, includePredictions: false };
  const localDetail = await mockProvider.getMatchDetail(detailQuery);
  let detail = localDetail;
  let source = mockProvider.source;

  try {
    if (provider !== mockProvider && typeof provider.getMatchDetail === "function") {
      const providerDetail = await withTimeout(provider.getMatchDetail(detailQuery), DEFAULT_TIMEOUT_MS);
      if (providerDetail) {
        detail = providerDetail;
        source = provider.source;
      }
    }
  } catch (error) {
    detail = localDetail;
    source = mockProvider.source;
  }

  if (detail) detail = require("../services/broadcastSchedule.js").applyVerifiedBroadcast(detail);
  const data = detail ? [detail] : [];

  if (!validateOrSend(res, data, validateMatchDetail)) {
    return;
  }

  // MAÇ SONU AÇIKLAMALARI yanıta burada ekleniyor, sağlayıcıdan gelmiyor.
  // Sağlayıcı alıntı vermiyor; alıntılar küratörlü depoda duruyor ve hangi
  // kaydın yayımlanabileceğine services/managerQuotes.js karar veriyor —
  // yani kural sunucuda tek yerde kalıyor, istemci yalnızca çiziyor.
  // Doğrulama SONRASINA konuldu: `validateMatchDetail` sağlayıcı sözleşmesini
  // denetliyor, bizim eklediğimiz alan o sözleşmenin parçası değil.
  if (detail) {
    detail.quotes = quotesForMatch(detail.id, managerQuoteStore);
    attachProbability(detail);
  }

  // Maç CANLIYSA önbellek politikası no-store'a geçer — bitmiş/başlamamış
  // maçta üstteki normal politika (kısa CDN önbelleği) geçerli kalır,
  // çünkü orada içerik dakikalarca değişmiyor ve önbellek gerçek bir
  // fayda sağlıyor.
  const status = String((detail && (detail.status || detail.providerStatus)) || "").toUpperCase();
  if (["LIVE", "HALFTIME", "1H", "2H", "ET", "P", "BT", "IN_PLAY", "PAUSED"].includes(status)) {
    setCachePolicy(res, "match-detail-live");
  }

  return sendSuccess(res, data, source);
};
