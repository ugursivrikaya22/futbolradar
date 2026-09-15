const { providerMeta, resolveFromProviders } = require("../services/liveDataService");
const { checkStandings } = require("../services/standingsIntegrity");
const {
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateOrSend,
  validateStandings
} = require("./_utils");

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "standings");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);

  // LİG ZORUNLU — "SÜPER LİG VARSAYILANI" KALDIRILDI.
  //
  // Burası eskiden `league` gelmediğinde sessizce "super-lig" koyuyordu.
  // Sonuç: ligini bildirmeyi unutan HER çağıran (bir maç sayfası widget'ı
  // dahil) Türkiye Süper Lig tablosunu alıyor, La Liga maçının altında
  // Süper Lig puan durumu beliriyordu. Varsayılan yerine açık hata: yanlış
  // ligin tablosunu servis etmektense hiçbir şey servis etmemek doğrudur.
  // Süper Lig tablosu artık yalnızca `league=super-lig` denildiğinde döner.
  const league = String(query.league || "").trim();
  if (!league) {
    return sendError(
      res,
      200,
      "Puan durumu icin 'league' parametresi zorunlu; varsayilan lig yok.",
      "MISSING_LEAGUE"
    );
  }

  // Sezon da sorguya girer: sağlayıcı önbelleği anahtarını sorgudan kurduğu
  // için (services/providerCache.js#cacheKey) anahtar zorunlu olarak
  // lig + sezon taşır — bir ligin tablosu başka bir ligin ya da başka bir
  // sezonun isteğine servis edilemez.
  const season = String(query.season || "").trim();
  const providerScope = { ...query, league, ...(season ? { season } : {}) };
  const result = await resolveFromProviders({
    resource: "standings",
    query: providerScope,
    run: (provider, providerQuery) => provider.getStandings(
      provider.name === "mock" ? providerScope : providerQuery
    )
  });

  if (!result.provider) {
    const firstError = result.attempts.find((attempt) => attempt.status === "error");
    return sendError(
      res,
      200,
      (firstError && firstError.message) || "Puan durumu hicbir saglayicidan alinamadi.",
      (firstError && firstError.code) || "PROVIDER_ERROR"
    );
  }

  const data = Array.isArray(result.data) ? result.data : [];
  if (!validateOrSend(res, data, validateStandings)) {
    return;
  }

  // validateStandings yalnızca ŞEKLİ doğrular (team + points var mı). O ≠
  // G+B+M ya da P ≠ 3·G+B gibi ARİTMETİK tutarsızlıkları services/
  // standingsIntegrity.js:checkStandings yakalar — qa.mjs ve
  // sync-standings.mjs bu kapıdan geçiyor ama bu uç nokta (canlı sağlayıcı
  // yolu) hiç geçmiyordu. Sayfa yine de servis edilir (tabloyu boşaltmak
  // hatalı bir satırdan daha kötü olurdu); ihlal varsa yalnızca sunucu
  // logunda ve `meta.integrity`de görünür — arayüz bunu okumaya bilerek
  // zorlanmıyor, bu değişiklik yalnızca sorunu görünür kılıyor.
  const violations = checkStandings(data);
  if (violations.length) {
    console.warn(`[futbolradar:standings-integrity] league=${league} season=${season || "-"} provider=${result.provider.name} violations=${JSON.stringify(violations)}`);
  }

  return sendSuccess(res, data, result.provider.source, undefined, providerMeta(result, { integrity: { violations } }));
};
