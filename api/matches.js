const { providerMeta, resolveFromProviders } = require("../services/liveDataService");
const { withRelevance } = require("../services/matchRelevance");
const { withHomePriority } = require("../services/homeMatchPriority");

let cachedHomeStandings;
function homeStandings() {
  if (cachedHomeStandings === undefined) {
    try {
      cachedHomeStandings = require("../data/league-standings.json");
    } catch {
      cachedHomeStandings = null;
    }
  }
  return cachedHomeStandings;
}
// Takım kimliği damgası: ana sayfa kişiselleştirmesi favori takımı bu
// alanla eşleştiriyor. İstemcide ad normalleştirmesiyle eşleştirmek 18
// kulübün yalnızca 5'inde tutardı — kimliklerin bir kısmı sağlayıcı numarası.
const { withTeamIds } = require("../services/teamIdentity");
// Kalıcı maç sayfası bağlantısı: sicilde sayfası olan maça `matchPage`.
const { withMatchPages } = require("../services/matchSeoPages");
// Yanıtın bayat olup olmadığı verinin kendisinden okunur.
const { assessFreshness } = require("../services/dataFreshness");
const {
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendError,
  sendSuccess,
  setCachePolicy,
  validateDateParam,
  validateMatches,
  validateOrSend
} = require("./_utils");

/**
 * Günün maç listesi.
 *
 * Every configured provider is tried in order and only then the curated
 * data set. A single provider failing (expired plan, rate limit, timeout)
 * used to return `ok:false` with an empty array, which rendered the match
 * pages as "bugün maç yok" even when another source had the fixtures. The
 * endpoint now degrades instead of failing, and reports what happened in
 * `meta` so the same class of outage is diagnosable from the response.
 */
function teamKeys(value) {
  const raw = String(value || "");
  const strip = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0131/g, "i").trim();
  return [strip(raw).toLowerCase(), strip(raw.toLocaleLowerCase("tr-TR"))].filter(Boolean);
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  // Günlük liste ve canlı skor aynı güncel kaynak yanıtlarını kullanır.
  setCachePolicy(res, "matches-live");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);
  const dateError = validateDateParam(query.date);
  if (dateError) {
    return sendError(res, 200, dateError, "INVALID_DATE");
  }

  const result = await resolveFromProviders({
    resource: "matches",
    query,
    isUsable: query.live ? Array.isArray : undefined,
    run: (provider, providerQuery) => provider.getMatches(providerQuery)
  });

  if (!result.provider) {
    const firstError = result.attempts.find((attempt) => attempt.status === "error");
    return sendError(
      res,
      200,
      (firstError && firstError.message) || "Mac verisi hicbir saglayicidan alinamadi.",
      (firstError && firstError.code) || "PROVIDER_ERROR"
    );
  }

  let pool = Array.isArray(result.data) ? result.data : [];
  if (!query.live && (result.degraded || result.provider.partialCoverage)) {
    const saved = await require('../services/providers/mockProvider').getMatches(query);
    pool = require('../services/dailyFixtureMerge').mergeDailyMatches(pool, saved);
  }
  const rawData = pool.map(match => ({ ...require("../services/broadcastSchedule").applyVerifiedBroadcast(match), fixturePriority: require("../services/dailyFixturePriority").fixturePriority(match) }));
  if (!validateOrSend(res, rawData, validateMatches)) {
    return;
  }

  // İLGİ PUANI BURADA DAMGALANIR — sağlayıcıdan bağımsız tek nokta.
  //
  // Sıralama kuralı istemcide DEĞİL, serviste duruyor: yarışma kataloğu ve
  // kulüp listeleri tarayıcıya inmeden istemci de sunucu da aynı sırayı
  // üretebilsin diye puan kaydın kendisine yazılıyor. Hiçbir maç elenmez;
  // yalnızca ne kadar öne çıkacağı belirlenir.
  // `locale=en` istendiğinde İngilizce maç sayfası yolu da damgalanır
  // (ana sayfa Radar Nabzı kartı İngilizce yüzeyde İngilizce sayfaya
  // bağlanabilsin diye). Türkçe istek bu ek tabloyu hiç yüklemez.
  // ANA SAYFA ÖNCELİK PUANI (services/homeMatchPriority.js): lig + takım +
  // derbi/zirve. Zirve için yalnızca mevcut puan durumu dosyası okunur.
  const allData = withMatchPages(withTeamIds(withHomePriority(withRelevance(rawData), { standings: homeStandings() })), undefined, {
    includeEn: String(query.locale || "").toLowerCase() === "en"
  });

  // TAKIM FİLTRESİ (yalnızca date=all): takım detay sayfası tüm sezonun
  // maç listesinden yalnızca kendi maçlarını kullanır. Filtresiz yanıt
  // ~15 MB JSON olduğundan, `team` verildiğinde liste sunucuda daraltılır.
  // Günlük/canlı sorgular (date=all olmayan) bu bloktan etkilenmez.
  let data = allData;
  const teamFilter = query.date === "all" && query.team ? teamKeys(query.team) : null;
  if (teamFilter) {
    data = allData.filter((match) => [match.homeTeam, match.awayTeam].some((name) => teamKeys(name).some((key) => teamFilter.includes(key))));
    // Canlı yoklama yapılmayan, sezon geneli liste: kısa CDN önbelleği yeterli.
    setCachePolicy(res, "matches");
  }

  // BAYATLIK YANITTA BİLDİRİLİR.
  //
  // Sağlayıcı kotayı doldurup 429 döndürdüğünde önbellek son başarılı yanıtı
  // servis ediyor — doğru davranış. Ama o yanıtın eski olduğu istemciye hiç
  // söylenmiyordu ve site sağlayıcı çökmüşken eski skoru CANLIYMIŞ gibi
  // gösteriyordu. Yanlış veri değil, yanlış iddia.
  const freshness = assessFreshness(data, {
    resource: query.live ? "matches-live" : "matches"
  });

  return sendSuccess(res, data, result.provider.source, undefined, providerMeta(result, { freshness, fixtureHealth: {
    date: query.date || require("../services/matchStatus").istanbulDay(new Date().toISOString()),
    timezone: "Europe/Istanbul", visible: data.length,
    state: data.length ? (result.degraded || result.provider.partialCoverage ? "degraded" : "ok")
      : result.attempts.some(a => a.provider === "api-football" && a.status === "empty") ? "empty-confirmed" : "unavailable"
  } }));
};
