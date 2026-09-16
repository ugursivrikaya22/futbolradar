const { getProvider, mockProvider } = require("../services/providers");
const probabilityStore = require("../services/fixturePredictionStore.js");
const probabilityService = require("../services/fixtureProbabilityService.js");
const { quotesForMatch } = require("../services/managerQuotes");
const managerQuoteStore = require("../data/manager-quotes.json");
const { isRadarPulseEnabled } = require("../services/featureFlags");
const { buildRadarPulse } = require("../services/radarPulseBuilder");
const { recordSample } = require("../services/livePulseStore");
const { resolveLiveWinProbability } = require("../services/winProbability");
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

/** Sağlayıcı bu kodlardan birini bildiriyorsa yanıt asla önbelleklenmez. */
const LIVE_CACHE_STATUSES = ["LIVE", "HALFTIME", "1H", "2H", "ET", "P", "BT", "IN_PLAY", "PAUSED", "INT", "SUSP"];

/** İlk vuruştan bu kadar önce önbellek kapanır — kick-off yanıtı donmasın. */
const PRE_KICKOFF_NO_STORE_MS = 10 * 60 * 1000;

/** İlk vuruştan sonra maçın sürebileceği en uzun süre (uzatma + penaltılar). */
const MATCH_WINDOW_MS = 210 * 60 * 1000;

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
    note: probabilityService.displayNoteFor(record, "tr") || display.note,
    home: record.probabilities.home,
    draw: record.probabilities.draw,
    away: record.probabilities.away,
    advice: record.advice || null,
    predictedWinner: record.predictedWinner || null,
    // Modelin veri temeli sınırlıysa açıklaması kartla birlikte gider:
    // yüzdeyi taşıyıp dayanağını taşımamak, dayanağı gizlemektir.
    dataBasis: record.dataBasis || null,
    basisNote: probabilityService.dataBasisNote(record, "tr"),
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

  // CANLI KAZANMA OLASILIĞI — SOKET UÇTAN UCA BAĞLI, BUGÜN BOŞ.
  //
  // `services/winProbability.js` bilerek boş bir soket: depoda maç İÇİ
  // olasılık üretebilen doğrulanmış bir model yok ve maç öncesi yüzdeyi
  // "canlı" diye yayımlamak, sayının gerçek ama iddianın yalan olduğu bir
  // durum yaratırdı. Çağrı yine de BURADA duruyor ki gerçek bir kaynak
  // takıldığı gün (registerSource) alan kendiliğinden dolsun ve maç
  // merkezindeki bölüm tek satır değişiklik olmadan açılsın. Bugün dönen
  // değer `null`; istemci de o zaman hiçbir şey çizmiyor.
  if (detail && liveNow) {
    try {
      detail.liveWinProbability = resolveLiveWinProbability({
        fixtureId: detail.fixtureId || detail.providerId || detail.id,
        minute: detail.minute,
        score: detail.score,
        statistics: detail.statistics,
        events: detail.events
      });
    } catch (error) {
      detail.liveWinProbability = null;
    }
  }

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

  // ÖNBELLEK KAPISI MAÇ PENCERESİNE GÖRE AÇILIR, DURUM KODUNA GÖRE DEĞİL.
  //
  // Eski kural yalnızca sağlayıcı ZATEN "canlı" diyorsa no-store'a geçiyordu
  // ve bu, düzeltmesi gereken anı tam olarak dışarıda bırakıyordu: başlama
  // saatinden hemen önceki yanıt "Başlamadı" içeriğiyle CDN'e yazılıyor
  // (s-maxage=30 + stale-while-revalidate=120), maç başladıktan sonra da iki
  // buçuk dakikaya kadar o yanıt servis ediliyordu. Depoda bu sorunun izi
  // duruyordu: TEK bir fikstür kimliği (Fenerbahçe-Roma) elle koda
  // yazılarak no-store'a alınmıştı. Aynı hata diğer bütün maçlarda
  // düzeltilmeden kalmıştı — kuralın maça özel değil, genel olması gerekir.
  //
  // Yeni kural: maç PENCERESİ içindeyken (başlamaya 10 dakika kala başlar,
  // ilk vuruştan 3,5 saat sonra biter) yanıt hiç önbelleklenmez. Bu
  // pencere, uzatma ve penaltılar dahil en uzun maçı ve sağlayıcının durum
  // kodunu geç güncellediği aralığı birlikte kapsar. Pencerenin dışında —
  // yarınki maç, dünkü sonuç — içerik dakikalarca değişmiyor ve kısa CDN
  // önbelleği gerçek bir fayda sağlıyor; orada eski politika sürüyor.
  //
  // Sağlayıcı canlı/devam eden bir durum bildiriyorsa pencere hesabından
  // bağımsız olarak yine no-store: kod her zaman saat hesabını ezer.
  const status = String((detail && (detail.status || detail.providerStatus)) || "").toUpperCase();
  const kickoffAt = Date.parse((detail && (detail.kickoff || detail.date)) || "");
  const sinceKickoff = Number.isNaN(kickoffAt) ? null : Date.now() - kickoffAt;
  const inMatchWindow = sinceKickoff !== null &&
    sinceKickoff > -PRE_KICKOFF_NO_STORE_MS &&
    sinceKickoff < MATCH_WINDOW_MS;

  // Kayıt HİÇ çözülemediyse (sağlayıcı hatası + kürasyonlu karşılığı yok)
  // yanıt boş döner. Boş yanıtın önbelleklenmesi, geçici bir sağlayıcı
  // kesintisini iki buçuk dakika boyunca "maç yok" olarak dondururdu;
  // istemcinin bir sonraki yoklaması da aynı boş yanıta çarpardı.
  if (!detail || inMatchWindow || LIVE_CACHE_STATUSES.includes(status)) {
    setCachePolicy(res, "match-detail-live");
  }

  return sendSuccess(res, data, source);
};
