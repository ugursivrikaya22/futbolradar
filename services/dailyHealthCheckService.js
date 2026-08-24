/**
 * GÜNLÜK SAĞLIK KONTROLÜ — TEK RAPORDA ÜÇ SORU.
 *
 * `/api/daily-health-check` ve `scripts/daily-health-check.mjs` AYNI raporu
 * üretmeli; mantık burada tek yerde toplanıyor ki ikisi farklı sayı vermesin.
 *
 *   1. Sayfa ayakta mı?              → checkSiteReachable
 *   2. Bayat maç kartı var mı?       → countStaleMatchAnalyses (salt okunur)
 *   3. Bayat ticker öğesi var mı?    → countStaleTickerItems (salt okunur)
 *   4. Canlı skor ne kadar gecikiyor? → liveLatencySnapshot
 *
 * BU MODÜL HİÇBİR DOSYAYA YAZMAZ. Sunucusuz işlev üretim dağıtımında salt
 * okunur bir dosya sistemi görür ve buradaki bir yazım git deposuna hiçbir
 * zaman yansımaz — gerçek temizlik (silme) yalnızca GitHub Actions'ın
 * checkout aldığı bir çalışma alanında, `scripts/prune-stale-match-analyses.mjs
 * --apply` ve `scripts/refresh-news-ticker.mjs --apply` ile, commit'e
 * dönüşerek olur. Bu modül yalnızca "kaç tanesi bayat" diye SAYAR.
 */
const fs = require("fs");
const path = require("path");

const { curatedMatches } = require("./providers/mockProvider");
const { isStaleAnalysisRecord, LIVE_STATES, matchState, kickoffMs } = require("./matchStatus");
const { shelfLifeVerdict } = require("./newsTicker");
const { listRecentAcrossMatches } = require("./liveEventLatency");

const ROOT = path.join(__dirname, "..");
const ANALYSES_PATH = path.join(ROOT, "data", "match-analyses.json");
const TICKER_PATH = path.join(ROOT, "data", "news-ticker.json");

/** Ticker öğesi için sabit raf ömrü — kullanıcı isteği burada AÇIKÇA "üç gün". */
const TICKER_MAX_AGE_HOURS = 72;

/** Canlı gecikme örneklemi için geriye bakılacak pencere. */
const LATENCY_LOOKBACK_HOURS = 48;

/** En fazla kaç maç kimliği sorguya dahil edilsin (tek istekte kalsın diye). */
const LATENCY_MATCH_ID_LIMIT = 200;

const DEFAULT_TIMEOUT_MS = 8000;

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { error: String((error && error.message) || error).slice(0, 200), fallback };
  }
}

/**
 * Üretim sayfasının ayakta olup olmadığını gerçek bir istekle sınar.
 * `url` boşsa (yerel/CI ortamında hedef yoksa) denenmediği bildirilir —
 * "ulaşılamadı" ile "hiç denenmedi" ayrımı önemli.
 */
async function checkSiteReachable(url, timeoutMs) {
  if (!url) {
    return { attempted: false, ok: false, note: "site url yapılandırılmadı" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    return {
      attempted: true,
      ok: response.ok,
      url,
      statusCode: response.status,
      responseTimeMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      url,
      responseTimeMs: Date.now() - startedAt,
      error: String((error && error.message) || error).slice(0, 200)
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bayat maç kartı analizlerini SAYAR (silmez).
 * Kural: services/matchStatus.js#isStaleAnalysisRecord — betikle aynı kural.
 */
function countStaleMatchAnalyses() {
  const raw = readJsonSafe(ANALYSES_PATH, []);
  if (raw && raw.error) {
    return { ok: false, error: raw.error, total: 0, stale: 0, staleIds: [] };
  }

  const analyses = Array.isArray(raw) ? raw : [];
  const pool = curatedMatches();
  const byId = new Map();
  for (const match of pool) {
    byId.set(String(match.id), match);
    const providerId = (match.providerIds && match.providerIds["api-football"]) || match.providerId;
    if (providerId) byId.set(String(providerId), match);
  }

  const staleIds = [];
  for (const record of analyses) {
    const key = String(record.fixtureId || record.slug || record.matchId || "");
    const match = byId.get(key) || null;
    if (isStaleAnalysisRecord(record, match)) staleIds.push(key);
  }

  return { ok: true, total: analyses.length, stale: staleIds.length, staleIds: staleIds.slice(0, 25) };
}

/**
 * Üç günden eski (ya da geçerlilik tarihi dolmuş) ticker öğelerini SAYAR
 * (silmez). `shelfLifeVerdict`e sabit `TICKER_MAX_AGE_HOURS` geçiriliyor —
 * kategori bazlı ayar ileride değişse bile bu rapor kullanıcının açıkça
 * istediği "üç gün" kuralını ölçmeye devam etsin diye.
 */
function countStaleTickerItems(now) {
  const raw = readJsonSafe(TICKER_PATH, { items: [] });
  if (raw && raw.error) {
    return { ok: false, error: raw.error, total: 0, stale: 0, staleIds: [] };
  }

  const items = Array.isArray(raw) ? raw : (Array.isArray(raw.items) ? raw.items : []);
  const staleIds = [];
  for (const entry of items) {
    const verdict = shelfLifeVerdict(entry, now, TICKER_MAX_AGE_HOURS);
    if (verdict.drop) staleIds.push(String(entry.id || ""));
  }

  return { ok: true, total: items.length, stale: staleIds.length, staleIds: staleIds.slice(0, 25), maxAgeHours: TICKER_MAX_AGE_HOURS };
}

function msBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return to - from;
}

function stageStats(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (!clean.length) return { sampleSize: 0, avgMs: null, maxMs: null, minMs: null };

  const sum = clean.reduce((total, value) => total + value, 0);
  return {
    sampleSize: clean.length,
    avgMs: Math.round(sum / clean.length),
    maxMs: Math.max(...clean),
    minMs: Math.min(...clean)
  };
}

/**
 * Son `LATENCY_LOOKBACK_HOURS` saat içindeki (canlı ya da yeni bitmiş)
 * maçların gol olayları üzerinden hat gecikmesini ölçer:
 * sağlayıcı → biz (fetchToDb), biz → API yanıtı (dbToApi), API yanıtı →
 * ekran (apiToRender). Supabase yapılandırılı değilse ya da o pencerede
 * hiç kayıt yoksa dürüstçe "örneklem yok" der — UYDURMA sayı üretmez.
 */
async function liveLatencySnapshot(now) {
  const pool = curatedMatches();
  const nowMs = now.getTime();
  const lookbackMs = LATENCY_LOOKBACK_HOURS * 60 * 60 * 1000;

  const relevantIds = pool
    .filter((match) => {
      const state = matchState(match);
      if (LIVE_STATES.has(state)) return true;
      const kickoff = kickoffMs(match);
      return kickoff !== null && nowMs - kickoff >= 0 && nowMs - kickoff <= lookbackMs;
    })
    .map((match) => match.id)
    .slice(0, LATENCY_MATCH_ID_LIMIT);

  if (!relevantIds.length) {
    return {
      ok: true,
      matchesChecked: 0,
      note: `son ${LATENCY_LOOKBACK_HOURS} saatte canlı/yakın zamanda oynanmış maç yok`,
      fetchToDb: stageStats([]),
      dbToApiResponse: stageStats([]),
      apiResponseToRender: stageStats([])
    };
  }

  const records = await listRecentAcrossMatches({ matchIds: relevantIds, limit: 500 });

  return {
    ok: true,
    matchesChecked: relevantIds.length,
    eventsObserved: records.length,
    fetchToDb: stageStats(records.map((record) => msBetween(record.firstSeenAt, record.dbWrittenAt))),
    dbToApiResponse: stageStats(records.map((record) => msBetween(record.dbWrittenAt, record.apiResponseAt))),
    apiResponseToRender: stageStats(records.map((record) => msBetween(record.apiResponseAt, record.clientRenderedAt)))
  };
}

/**
 * Dört bölümü tek raporda birleştirir. `siteUrl` boş bırakılabilir (site
 * kontrolü o zaman "denenmedi" döner, hata değil).
 */
async function buildDailyHealthReport({ siteUrl, now, timeoutMs } = {}) {
  const at = now instanceof Date ? now : new Date();

  const [site, latency] = await Promise.all([
    checkSiteReachable(siteUrl, timeoutMs),
    liveLatencySnapshot(at)
  ]);

  const matchCards = countStaleMatchAnalyses();
  const ticker = countStaleTickerItems(at);

  const healthy = site.attempted ? site.ok : true;

  return {
    generatedAt: at.toISOString(),
    status: healthy ? "healthy" : "degraded",
    site,
    matchCards,
    ticker,
    liveLatency: latency
  };
}

module.exports = {
  LATENCY_LOOKBACK_HOURS,
  TICKER_MAX_AGE_HOURS,
  buildDailyHealthReport,
  checkSiteReachable,
  countStaleMatchAnalyses,
  countStaleTickerItems,
  liveLatencySnapshot
};
