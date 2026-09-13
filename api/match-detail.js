const { getProvider, mockProvider } = require("../services/providers");
const { quotesForMatch } = require("../services/managerQuotes");
const managerQuoteStore = require("../data/manager-quotes.json");
const { isRadarPulseEnabled } = require("../services/featureFlags");
const { buildRadarPulse } = require("../services/radarPulseBuilder");
const { recordSample } = require("../services/livePulseStore");
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
  const localDetail = await mockProvider.getMatchDetail(query);
  let detail = localDetail;
  let source = mockProvider.source;

  try {
    if (provider !== mockProvider && typeof provider.getMatchDetail === "function") {
      const providerDetail = await withTimeout(provider.getMatchDetail(query), DEFAULT_TIMEOUT_MS);
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
  }

  // RADAR NABZI — SAĞLAYICIYA FAZLADAN İSTEK ATMADAN.
  //
  // Nabız, ZATEN alınmış olan bu yanıttan hesaplanır: ek uç nokta yok, ek
  // sağlayıcı çağrısı yok, istemci için ek istek yok. Ayrı bir
  // `/api/radar-pulse` yazmak, aynı maçı izleyen her okuyucu için ikinci bir
  // tur demek olurdu — istenen tam tersiydi.
  //
  // "Son 10 dakika" farkı için anlık görüntü BURADA kaydedilir; sağlayıcı
  // kümülatif toplam döndürdüğü için pencere ancak iki zaman noktasının
  // farkından doğabilir (bkz. services/livePulseStore.js).
  // YALNIZCA OYNANAN MAÇ. Radar Nabzı "şu anki baskı"dır; bitmiş bir maçta
  // gösterilecek bir "şu an" yok. Bitmiş maçta hesaplamak yalnızca boşa iş
  // değil, ZARARLI olurdu: anlık görüntü deposu sınırlı (60 maç) ve arşiv
  // sayfaları en çok trafiği alan sayfalar — her arşiv görüntülemesi bir
  // kayıt açsaydı, gerçekten CANLI olan maçların görüntüleri depodan
  // düşerdi ve "son 10 dakika" penceresi tam ihtiyaç duyulan anda kaybolurdu.
  const liveNow = ["LIVE", "HALFTIME", "HT", "1H", "2H", "ET", "BT", "P", "IN_PLAY", "PAUSED", "INT", "SUSP"]
    .includes(String((detail && (detail.providerStatus || detail.status)) || "").toUpperCase());

  if (detail && liveNow && isRadarPulseEnabled()) {
    try {
      const fixtureKey = detail.fixtureId || detail.providerId || detail.id || query.fixtureId || query.id;
      const samples = recordSample(fixtureKey, {
        minute: detail.minute,
        statistics: detail.statistics,
        score: detail.score
      });
      const pulse = buildRadarPulse({
        detail,
        samples,
        locale: String(query.locale || "").toLowerCase() === "en" ? "en" : "tr"
      });
      // Nabız hesaplanamadıysa (ölçülmüş faktör yok) alan yine taşınır ama
      // içi boştur: istemci "veri yok" ile "özellik kapalı"yı ayırt etsin.
      detail.radarPulse = pulse;
    } catch (error) {
      // Nabız YARDIMCI bir katman. Hesabı patlarsa maç detayı yine döner;
      // eksik olan bölüm gizlenir, sayfa çalışmaya devam eder.
      detail.radarPulse = null;
    }
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
