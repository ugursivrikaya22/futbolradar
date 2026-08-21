/**
 * CANLI SKOR GECİKME UÇ NOKTASI — `/api/live-latency`.
 *
 * DOSYA `api/` ALTINDA DEĞİL, ÇÜNKÜ ORASI SAYILIYOR. Vercel Hobby planı
 * en fazla 12 sunucusuz işlev veriyor; `api/` dizini zaten 12 dosyada
 * (`api/[...route].js` dahil). Aynı gerekçe `server/motmVoteRoute.js`
 * başlığında yazılı. Yönlendirme `api/[...route].js` üzerinden.
 *
 *   GET  /api/live-latency?id=<matchId>   → maçı sağlayıcıdan TAZE çeker
 *                                            (no-store), yeni gol
 *                                            olaylarını kütüğe yazar,
 *                                            bilinen tüm kayıtları döner.
 *   POST /api/live-latency                → istemcinin "ekrana bastım"
 *                                            işaretini aynı satıra yazar
 *                                            (gövde: { eventKey }).
 *
 * NEDEN NO-STORE. Bu uç nokta HER çağrıda sağlayıcıya gidip yeni gol var
 * mı diye bakmak zorunda — CDN/tarayıcı önbelleği bir maçta dakikalarca
 * "yeni gol yok" cevabını dondurabilirdi. `_utils.js`teki "live-latency"
 * politikası bilerek `noStore: true`.
 */
const { getProvider, mockProvider } = require("../services/providers");
const {
  classifyGoalEvents,
  listRecent,
  markApiResponded,
  markRendered,
  recordObservedGoals
} = require("../services/liveEventLatency");
const {
  DEFAULT_TIMEOUT_MS,
  enforceRateLimit,
  getQuery,
  sendError,
  sendSuccess,
  setCachePolicy,
  withTimeout
} = require("../api/_utils");

const SOURCE = "live-latency";

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return null;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    return null;
  }
}

async function fetchFreshDetail(query) {
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

  return { detail, source };
}

async function handleGet(req, res) {
  const query = getQuery(req);
  const matchId = String(query.id || "").trim();
  if (!matchId) {
    return sendError(res, 400, "id zorunlu (?id=<matchId>).", "MATCH_ID_REQUIRED", SOURCE);
  }

  const fetchStartedAt = Date.now();
  const { detail, source } = await fetchFreshDetail(query);
  // BİZİM ÇEKTİĞİMİZ ZAMAN: sağlayıcı yanıtı ELİMİZE GEÇTİĞİ an — istek
  // gönderildiği an değil. Ağ gecikmesi bu ölçümün bir parçası olsun diye.
  const firstSeenAt = new Date().toISOString();
  const fetchDurationMs = Date.now() - fetchStartedAt;

  if (!detail) {
    return sendError(res, 200, "Bu mac icin veri bulunamadi.", "MATCH_NOT_FOUND", SOURCE);
  }

  // BİLİNEN KAYITLAR — diff burada, kayıt modülünde değil: aynı golü her
  // yoklamada yeniden yazmak "ilk gördüğümüz an" ölçümünü anlamsızlaştırır.
  const known = await listRecent({ matchId, limit: 200 });
  const knownKeys = new Set(known.map((record) => record.eventKey));

  const { computeEventKey } = require("../services/liveEventLatency");
  const goals = classifyGoalEvents(detail.events);
  const freshGoals = goals.filter((event) => !knownKeys.has(
    computeEventKey(matchId, event, detail.homeTeam, detail.awayTeam)
  ));

  const newlyRecorded = freshGoals.length
    ? await recordObservedGoals({
      matchId,
      kickoff: detail.kickoff,
      homeTeam: detail.homeTeam,
      awayTeam: detail.awayTeam,
      events: freshGoals,
      firstSeenAt
    })
    : [];

  const apiResponseAt = new Date().toISOString();
  const stamped = newlyRecorded.length ? await markApiResponded(newlyRecorded, apiResponseAt) : [];

  const allRecords = [...stamped, ...known.filter((record) => !stamped.some((fresh) => fresh.eventKey === record.eventKey))]
    .sort((left, right) => Date.parse(right.firstSeenAt) - Date.parse(left.firstSeenAt));

  return sendSuccess(res, {
    matchId,
    status: detail.status || detail.providerStatus || null,
    score: detail.score || null,
    minute: detail.minute || detail.elapsed || null,
    fetchDurationMs,
    events: allRecords
  }, source, undefined, { newGoalsObserved: newlyRecorded.length });
}

async function handlePost(req, res) {
  const body = await readJsonBody(req);
  const eventKey = String((body && body.eventKey) || "").trim();
  if (!eventKey) {
    return sendError(res, 400, "eventKey zorunlu.", "EVENT_KEY_REQUIRED", SOURCE);
  }

  // EKRANA DÜŞME ZAMANI İSTEMCİDEN GELİR — sunucu bunu ölçemez. Sunucu
  // yalnızca kaydı geri okuyup teyit eder; istemcinin uydurduğu bir
  // zaman damgasına güvenmez, yalnızca "şimdi" ile damgalar.
  const record = await markRendered({ eventKey, clientRenderedAt: new Date().toISOString() });

  if (!record) {
    return sendError(res, 404, "Bilinmeyen eventKey.", "EVENT_NOT_FOUND", SOURCE);
  }

  return sendSuccess(res, record, SOURCE);
}

async function handleLiveLatency(req, res) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, HEAD, POST, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }
  // HEAD, GET'in gövdesiz hâlidir — uptime kontrolleri ve bazı CDN/tarayıcı
  // ön istekleri kullanır. `api/_utils.js` rejectUnsupportedMethod'un GET
  // yanında HEAD'i de kabul etmesiyle AYNI gerekçe (bkz. o dosyadaki yorum):
  // reddedilirse izleme araçlarında sahte "endpoint kapalı" alarmı üretir.
  // Ayrıca burada set edilmeden önce 405 dönmek `setCachePolicy`in hiç
  // çağrılmamasına, yanıtın varsayılan (önbelleklenebilir) politikayla
  // gitmesine yol açardı — canlı bir uç nokta için yanlış.
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    res.setHeader("Allow", "GET, HEAD, POST, OPTIONS");
    setCachePolicy(res, "live-latency");
    return sendError(res, 405, "Bu uc nokta yalnizca GET, HEAD ve POST kabul eder.", "METHOD_NOT_ALLOWED", SOURCE);
  }

  setCachePolicy(res, "live-latency");
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: method === "POST" ? 240 : 60 })) return undefined;

  try {
    return method === "POST" ? await handlePost(req, res) : await handleGet(req, res);
  } catch (error) {
    return sendError(res, 200, "Canli gecikme verisi alinamadi.", "LIVE_LATENCY_ERROR", SOURCE);
  }
}

module.exports = { handleLiveLatency };
