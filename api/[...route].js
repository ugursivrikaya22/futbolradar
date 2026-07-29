const { getProvider, mockProvider } = require("../services/providers");
const { mergeProviderPlayers } = require("../services/playerService");
const { enrichPlayerRating } = require("../services/ratingService");
const { MODEL_VERSION: MATCH_PREDICTION_MODEL_VERSION } = require("../services/matchPredictionService");
const { getFixtureWeeks, groupMatchesIntoWeeks } = require("../services/superLigFixtureService");
const { providerMeta, resolveFromProviders } = require("../services/liveDataService");
const { supabaseHealth } = require("../services/supabase/health");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  normalizeText,
  rejectUnsupportedMethod,
  sendError,
  sendJson,
  sendSuccess,
  setCachePolicy,
  validateAnalyses,
  validateMatchDetail,
  validateOrSend,
  withTimeout
} = require("./_utils");

/**
 * HER UCUN KENDİ ÖNBELLEK PENCERESİ VAR.
 *
 * Bu toplayıcı birden çok ucu tek işlevde topluyor; hepsine aynı pencereyi
 * vermek, dakikalar içinde değişen bir yanıtı saatlerce taze sanmak (ya da
 * tersine, günde bir değişen bir yanıtı boşuna yeniden hesaplamak) demek
 * olurdu. Ayrı dosyada yaşarken her ucun taşıdığı politika burada da adıyla
 * korunuyor; eşleşmeyen yol istemci uçlarının varsayılanına düşer.
 */
const ROUTE_CACHE_POLICIES = Object.freeze({
  "match-analysis": "match-analysis",
  analyses: "analyses",
  "match-detail": "match-detail"
});

async function getPlayerData(query) {
  const provider = getProvider("players");
  const localData = await mockProvider.getPlayers(query);
  let data = localData;
  let source = mockProvider.source;

  try {
    if (provider !== mockProvider) {
      const providerData = await withTimeout(provider.getPlayers(query), DEFAULT_TIMEOUT_MS);
      if (Array.isArray(providerData) && providerData.length) {
        data = mergeProviderPlayers(localData, providerData, provider.name);
        source = provider.source;
      }
    }
  } catch (error) {
    data = localData;
    source = mockProvider.source;
  }

  return {
    data: data.map((player) => enrichPlayerRating(player)),
    source
  };
}

function routeName(req) {
  const url = new URL(req.url || "/", "http://localhost");
  return normalizeText(url.pathname.replace(/^\/api\/?/, "").split("/")[0]);
}

function requestedPlayers(query) {
  const explicit = String(query.players || "")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
  const positional = [query.p1, query.p2, query.p3].map((item) => normalizeText(item)).filter(Boolean);
  return (explicit.length ? explicit : positional).slice(0, 3);
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rankingScore(player, type) {
  const radar = player.radar || {};
  if (type === "forward") {
    return player.positionGroup === "forward" || player.positionGroup === "winger" ? numberValue(radar.attack, 0) : -1;
  }
  if (type === "midfielder") {
    return player.positionGroup === "midfielder" ? numberValue(radar.creativity, 0) : -1;
  }
  if (type === "defender") {
    return player.positionGroup === "defender" ? numberValue(radar.defense, 0) : -1;
  }
  if (type === "goalkeeper") {
    return player.positionGroup === "goalkeeper" ? numberValue(radar.defense, 0) : -1;
  }
  if (type === "rising") {
    return numberValue(player.formChange, 0) * 12 + numberValue(radar.form, 0);
  }
  if (type === "young") {
    const age = numberValue(player.computedAge || player.age, 99);
    return age <= 23 ? numberValue(radar.potential, 0) : -1;
  }
  if (type === "transfer") {
    return numberValue(radar.transferValue, 0);
  }

  return numberValue(radar.overall, numberValue(player.overallRating || player.aiRating || player.rating, 0));
}

async function handlePlayerDetail(req, res, query) {
  const wanted = normalizeText(query.id || query.slug || query.player || query.playerId);
  const { data, source } = await getPlayerData(query);
  const player = wanted
    ? data.find((item) => {
      return normalizeText(item.id) === wanted || normalizeText(item.slug) === wanted || normalizeText(item.name) === wanted;
    })
    : data[0];

  if (!player) {
    return sendError(res, 200, "Oyuncu kaydi bulunamadi.", "PLAYER_NOT_FOUND", source);
  }

  return sendSuccess(res, [player], source);
}

async function handlePlayerCompare(req, res, query) {
  const { data, source } = await getPlayerData(query);
  const wanted = requestedPlayers(query);
  const selected = wanted.length
    ? wanted.map((id) => data.find((player) => {
      return normalizeText(player.id) === id || normalizeText(player.slug) === id || normalizeText(player.name) === id;
    })).filter(Boolean)
    : data.slice(0, 3);

  if (selected.length < 2) {
    return sendError(res, 200, "Karsilastirma icin en az iki oyuncu bulunmali.", "PLAYER_COMPARE_NOT_ENOUGH_PLAYERS", source);
  }

  return sendSuccess(res, selected.slice(0, 3), source);
}

async function handlePlayerRankings(req, res, query) {
  const type = normalizeText(query.type || "overall");
  const limit = Math.max(1, Math.min(50, Number(query.limit) || 10));
  const { data, source } = await getPlayerData(query);
  const ranked = data
    .map((player) => ({ ...player, rankingScore: rankingScore(player, type) }))
    .filter((player) => player.rankingScore >= 0)
    .sort((a, b) => b.rankingScore - a.rankingScore)
    .slice(0, limit)
    .map((player, index) => ({
      ...player,
      rank: index + 1,
      rankingType: type
    }));

  return sendSuccess(res, ranked, source);
}

/**
 * Full Süper Lig season, grouped into weeks. Always starts from the
 * curated data/super-lig-fixtures.json (season metadata, team pool,
 * verified venues) and only ever swaps in `rounds` from a live provider —
 * every other editorial field is left untouched. No limit/page parameter
 * is applied; a provider fetch failure or empty result simply keeps the
 * curated rounds instead of guessing.
 */
async function handleSuperLigFixtures(req, res, query) {
  const fixturesData = require("../data/super-lig-fixtures.json");
  const result = await resolveFromProviders({
    resource: "super-lig-fixtures",
    query,
    run: (provider, providerQuery) => {
      if (typeof provider.getSeasonFixtures !== "function") {
        return [];
      }

      return provider.getSeasonFixtures(providerQuery);
    },
    // A live season feed is only usable once it actually groups into weeks;
    // anything less keeps the curated, editorially verified rounds.
    isUsable: (data) => Array.isArray(data) && data.length > 0 && groupMatchesIntoWeeks(data).length > 0
  });

  const liveRounds = Array.isArray(result.data) && result.data.length ? groupMatchesIntoWeeks(result.data) : [];
  const useLive = liveRounds.length > 0 && result.provider && result.provider !== mockProvider;

  return sendSuccess(
    res,
    {
      ...fixturesData,
      rounds: useLive ? liveRounds : getFixtureWeeks(fixturesData),
      roundsSource: useLive ? "provider" : "curated"
    },
    useLive ? result.provider.source : mockProvider.source,
    undefined,
    providerMeta(result, { roundsSource: useLive ? "provider" : "curated" })
  );
}

function matchAnalysisResponse(res, statusCode, payload) {
  return sendJson(res, statusCode, payload);
}

async function handleMatchAnalysis(req, res, query) {
  const fixtureId = normalizeText(query.fixtureId);
  const slugQuery = normalizeText(query.slug);

  if (!fixtureId && !slugQuery) {
    return matchAnalysisResponse(res, 200, {
      ok: false,
      source: "FutbolRadar Analysis",
      updatedAt: null,
      method: MATCH_PREDICTION_MODEL_VERSION,
      error: { code: "MATCH_ANALYSIS_QUERY_REQUIRED", message: "fixtureId veya slug parametresi gerekli." },
      data: null
    });
  }

  let analyses = [];
  try {
    analyses = require("../data/match-analyses.json");
  } catch (error) {
    return matchAnalysisResponse(res, 200, {
      ok: false,
      source: "FutbolRadar Analysis",
      updatedAt: null,
      method: MATCH_PREDICTION_MODEL_VERSION,
      error: { code: "MATCH_ANALYSIS_UNAVAILABLE", message: "Maç analizi verisi şu anda okunamıyor." },
      data: null
    });
  }

  const record = (Array.isArray(analyses) ? analyses : []).find((item) => {
    return (fixtureId && normalizeText(item.fixtureId) === fixtureId) || (slugQuery && normalizeText(item.slug) === slugQuery);
  });

  if (!record) {
    return matchAnalysisResponse(res, 404, {
      ok: false,
      source: "FutbolRadar Analysis",
      updatedAt: null,
      method: MATCH_PREDICTION_MODEL_VERSION,
      error: { code: "MATCH_ANALYSIS_NOT_FOUND", message: "Bu maç için analiz bulunamadı." },
      data: null
    });
  }

  if (record.analysisStatus === "unavailable") {
    return matchAnalysisResponse(res, 200, {
      ok: true,
      source: "FutbolRadar Analysis",
      updatedAt: record.generatedAt || null,
      method: record.modelVersion || MATCH_PREDICTION_MODEL_VERSION,
      status: "unavailable",
      data: record
    });
  }

  return matchAnalysisResponse(res, 200, {
    ok: true,
    source: "FutbolRadar Analysis",
    updatedAt: record.generatedAt || null,
    method: record.modelVersion || MATCH_PREDICTION_MODEL_VERSION,
    data: record
  });
}

/**
 * ANALİZ LİSTESİ UCU (eski api/analyses.js).
 *
 * Vercel Hobby planında api/ altındaki her dosya ayrı bir işlev sayılıyor ve
 * sınır 12. Yeni uçlar (analysis-brain, report-status) eklendiğinde sınır
 * aşıldı; scripts/qa.mjs bunu derlemeden önce yakalıyor. Bu iki sağlayıcı
 * geçişi ucu, toplayıcının ZATEN yüklediği modüllerden başka hiçbir şeye
 * ihtiyaç duymadığı için buraya taşındı: birleşme ne yeni bağımlılık ne de
 * yeni soğuk başlangıç maliyeti getiriyor. Yol, yanıt biçimi ve önbellek
 * penceresi birebir aynı kaldı — /api/analyses hâlâ /api/analyses.
 */
async function handleAnalyses(req, res, query) {
  const provider = getProvider("analyses");
  let data = [];

  try {
    data = await withTimeout(provider.getAnalyses(query), DEFAULT_TIMEOUT_MS);
  } catch (error) {
    return sendError(
      res,
      200,
      error.message || "Analiz verisi provider katmanindan alinamadi.",
      error.code || "PROVIDER_ERROR"
    );
  }

  if (!validateOrSend(res, data, validateAnalyses)) {
    return;
  }

  return sendSuccess(res, data, provider.source);
}

/**
 * MAÇ DETAYI UCU (eski api/match-detail.js).
 *
 * Sağlayıcı sessizce devreye girmez: canlı sağlayıcı hata verirse ya da boş
 * dönerse kürasyonlu kayıt korunur ve kaynak adı da kürasyonlu kaynağı
 * gösterir. Yanıtın "kim söyledi" bilgisi, veriyi kimin verdiğiyle her zaman
 * aynı kalmalı.
 */
async function handleMatchDetail(req, res, query) {
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

  const data = detail ? [detail] : [];

  if (!validateOrSend(res, data, validateMatchDetail)) {
    return;
  }

  return sendSuccess(res, data, source);
}

/**
 * SUPABASE SAĞLIĞI.
 *
 * Kendi dosyası YOK ve olamaz: api/ dizini Vercel Hobby planının 12 fonksiyon
 * sınırında. Yeni bir uç noktanın kendi dosyası olsaydı dağıtım tamamen
 * başarısız olurdu — bu yüzden yönlendirici üzerinden servis ediliyor.
 *
 * `?probe=1` verilmedikçe AĞA ÇIKMAZ: her sağlık isteğinin veritabanına
 * gitmesi gereksiz yük ve gereksiz gecikme olurdu.
 *
 * Anahtar değeri hiçbir koşulda yanıta girmez (services/supabase/health.js).
 */
async function handleSupabaseHealth(req, res, query) {
  try {
    const report = await supabaseHealth({
      probe: String(query.probe || "") === "1" || String(query.probe || "") === "true"
    });
    return sendSuccess(res, [report], "FutbolRadar Supabase Health");
  } catch (error) {
    // Sağlık ucu çökmemeli: sorunu bildirmek onun işi.
    return sendError(
      res,
      200,
      (error && error.message) || "Supabase sağlık raporu üretilemedi.",
      "SUPABASE_HEALTH_ERROR"
    );
  }
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  const route = routeName(req);
  setCachePolicy(res, ROUTE_CACHE_POLICIES[route] || "players");
  if (enforceRateLimit(req, res)) return;

  const query = getQuery(req);

  if (route === "player-detail") {
    return handlePlayerDetail(req, res, query);
  }

  if (route === "player-compare") {
    return handlePlayerCompare(req, res, query);
  }

  if (route === "player-rankings") {
    return handlePlayerRankings(req, res, query);
  }

  if (route === "match-analysis") {
    return handleMatchAnalysis(req, res, query);
  }

  if (route === "super-lig-fixtures") {
    return handleSuperLigFixtures(req, res, query);
  }

  if (route === "analyses") {
    return handleAnalyses(req, res, query);
  }

  if (route === "supabase-health") {
    return handleSupabaseHealth(req, res, query);
  }

  if (route === "match-detail") {
    return handleMatchDetail(req, res, query);
  }

  return sendError(res, 404, "API endpoint bulunamadi.", "API_ROUTE_NOT_FOUND");
};
