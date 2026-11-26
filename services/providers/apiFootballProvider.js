const { buildSeasonSnapshot } = require("../apiFootballPlayerMetrics.js");
const {
  APIFOOTBALL_API_KEY_ENV_NAMES,
  APIFOOTBALL_LEAGUE_ID_ENV_NAMES,
  APIFOOTBALL_BASE_URL_ENV_NAMES,
  APIFOOTBALL_SEASON_ENV_NAMES,
  APIFOOTBALL_COUNTRY_ENV_NAMES,
  DEFAULT_TIMEOUT_MS,
  firstPresentEnv,
  normalizeText,
  withTimeout
} = require("../../api/_utils");
const { competitions, matchesCompetition, findCompetitionByProviderId, isForeignNamesake } = require("../competitionCatalog");
const { canonicalStatus } = require("../matchStatus");
const { fetchWithCache, ttlFor } = require("../providerCache");
const { modeFor } = require('../operationsPolicy');
const operationsConfig = require('../../data/operations-policy.json');
// Bağımlılığı olmayan bir okuyucu; leagueResolver'ı require etmek sağlayıcı
// ile resolver arasında döngü yaratırdı.
const { readCachedLeague } = require("../leagueCache");
const { canonicalizeStatistics } = require("../matchStatisticsSchema");
const { createHash } = require("node:crypto");

const source = "FutbolRadar API-Football Live API";
const DEFAULT_BASE_URL = "https://v3.football.api-sports.io";

// Sağlayıcının kabul ettiği anahtar, süreç içinde hatırlanır: her istekte
// baştan aday taramak gereksiz çağrı ve gecikme demek. Kimlik hatasında
// sıfırlanır, yani anahtar değişirse kendiliğinden yeniden keşfedilir.
let activeApiKey = null;

class ProviderError extends Error {
  constructor(code, message, statusCode, raw) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.statusCode = statusCode || 200;
    this.raw = raw;
  }
}

/**
 * API-Football labels a European season by its starting year, so anything
 * from July onwards belongs to the season that starts that year. Deriving
 * it beats the previous hard-coded "2026" default, which silently pointed
 * at the wrong season the moment the calendar rolled over.
 */
function seasonForDate(value) {
  const date = value ? new Date(`${String(value).slice(0, 10)}T12:00:00Z`) : new Date();
  const reference = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = reference.getUTCFullYear();
  return String(reference.getUTCMonth() + 1 >= 7 ? year : year - 1);
}

// API-Sports anahtarları tam olarak 32 onaltılık karakterdir. Biçim
// kontrolü, eksik kopyalanmış ya da yanlış yapıştırılmış bir anahtarı
// sağlayıcıya sormadan ayırt etmeyi sağlar.
const API_KEY_PATTERN = /^[a-f0-9]{32}$/i;

function looksLikeApiKey(value) {
  return API_KEY_PATTERN.test(String(value || ""));
}

/**
 * Tanımlı tüm anahtar değişkenlerinin benzersiz değerleri, öncelik
 * sırasına göre. Ortamda birden fazla APIFOOTBALL_* değişkeni bulunması
 * yaygın: eski anahtar bir isimde kalırken yeni anahtar başka bir isme
 * yazılıyor. Tek bir ismi okuyup ilkinde pes etmek, doğru anahtar ortamda
 * dururken canlı veriyi tamamen kaybettiriyordu.
 */
function apiKeyCandidates() {
  const values = APIFOOTBALL_API_KEY_ENV_NAMES
    .map((name) => String(process.env[name] || "").trim())
    .filter(Boolean);
  const unique = [...new Set(values)];
  // Biçimi geçerli olanlar önce denenir; bozuk bir anahtar sırf ismi önde
  // diye sağlam olanı gölgelemesin.
  return [...unique.filter(looksLikeApiKey), ...unique.filter((value) => !looksLikeApiKey(value))];
}

function getConfig() {
  const candidates = apiKeyCandidates();
  return {
    provider: process.env.FOOTBALL_PRIMARY_PROVIDER || "api-football",
    baseUrl: firstPresentEnv(APIFOOTBALL_BASE_URL_ENV_NAMES) || DEFAULT_BASE_URL,
    apiKey: activeApiKey && candidates.includes(activeApiKey) ? activeApiKey : candidates[0] || "",
    apiKeyCandidateCount: candidates.length,
    leagueId: firstPresentEnv(APIFOOTBALL_LEAGUE_ID_ENV_NAMES),
    season: firstPresentEnv(APIFOOTBALL_SEASON_ENV_NAMES) || seasonForDate(),
    country: firstPresentEnv(APIFOOTBALL_COUNTRY_ENV_NAMES) || "Turkey"
  };
}

function hasConfig() {
  const config = getConfig();
  return Boolean(config.apiKey && config.baseUrl);
}

function assertConfig() {
  const config = getConfig();

  if (!config.apiKey) {
    throw new ProviderError("PROVIDER_CONFIG_MISSING", "API-Football provider icin APIFOOTBALL_API_KEY gerekli.");
  }

  if (!config.baseUrl) {
    throw new ProviderError("PROVIDER_CONFIG_MISSING", "API-Football provider icin APIFOOTBALL_API_BASE_URL gerekli.");
  }

  return config;
}

function compactParams(params) {
  return Object.fromEntries(
    Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function mapHttpError(status) {
  if (status === 401 || status === 403) {
    return "PROVIDER_AUTH_ERROR";
  }

  if (status === 404) {
    return "PROVIDER_NOT_FOUND";
  }

  if (status === 429) {
    return "PROVIDER_RATE_LIMIT";
  }

  return "PROVIDER_HTTP_ERROR";
}

function publicErrorMessage(code, status) {
  if (code === "PROVIDER_AUTH_ERROR") return "Live provider kimlik dogrulamasi basarisiz.";
  if (code === "PROVIDER_RATE_LIMIT") return "Live provider istek limiti doldu.";
  if (code === "PROVIDER_NOT_FOUND") return "Live provider istenen kaydi bulamadi.";
  return `Live provider istegi basarisiz oldu (HTTP ${status}).`;
}

function apiErrors(payload) {
  if (!payload || !payload.errors) {
    return [];
  }

  if (Array.isArray(payload.errors)) {
    return payload.errors.filter(Boolean);
  }

  if (typeof payload.errors === "object") {
    return Object.values(payload.errors).filter(Boolean);
  }

  return [payload.errors].filter(Boolean);
}

function classifyPayloadError(errors) {
  const text = (errors || [])
    .map((error) => typeof error === "string" ? error : JSON.stringify(error))
    .join(" ")
    .toLowerCase();

  // "Your account is suspended, check on https://dashboard.api-football.com."
  // Production'da dönen ikinci hata. Hesap düzeyinde bir durum; yeniden
  // denemek anlamsız, zincir hemen bir sonraki sağlayıcıya geçmeli.
  if (/suspend|account is (disabled|blocked)/.test(text)) {
    return {
      code: "PROVIDER_ACCOUNT_SUSPENDED",
      message: "API-Football hesabi askiya alinmis; canli saglayici devre disi."
    };
  }

  // API-Sports iki farkli durumu iki farkli metinle bildiriyor ve ayrimi
  // yapmak teshisi tamamen degistiriyor:
  //
  //   header hic yok / bos ->
  //     "Missing application key, Check our documentation on how to add
  //      your API key in headers."   (payload'da error kodu "4xHe")
  //   header var ama anahtar taninmiyor ->
  //     "Error/Missing application key. Go to https://www.api-football.com/
  //      documentation-v3 to learn how to get your API application key."
  //
  // Ikisi de "missing application key" icerdigi icin tek kaliba dusurulunce
  // "anahtari header'a koymayi unutmusuz" ile "anahtar yanlis" ayirt
  // edilemiyordu. Ilk durum bizim hatamiz, ikincisi kimlik bilgisinin
  // kendisiyle ilgili.
  if (/check our documentation on how to add your api key in headers/.test(text)) {
    return {
      code: "PROVIDER_CREDENTIAL_NOT_SENT",
      message: "API-Football istegine anahtar basligi gonderilmedi; ortam degiskeni bos okunuyor."
    };
  }

  if (/api.?key|application key|token|auth|unauthor|forbidden/.test(text)) {
    return {
      code: "PROVIDER_AUTH_ERROR",
      message: "API-Football anahtari gonderildi ancak saglayici tarafindan taninmadi (gecersiz, iptal edilmis veya farkli bir platforma ait)."
    };
  }

  if (/rate.?limit|request.?limit|quota|too many requests/.test(text)) {
    return {
      code: "PROVIDER_RATE_LIMIT",
      message: "API-Football istek limiti doldu; statik yedek veri kullanilacak."
    };
  }

  // "Free plans do not have access to this season, try from 2022 to 2024."
  // is the exact production failure: the configured key cannot serve the
  // current season at all, so this must classify as a plan problem (a
  // permanent, skip-this-provider condition) and never as "no data today".
  if (/subscription|subscribed|pricing|plan|upgrade|not allowed|do not have access|does not have access|access denied/.test(text)) {
    return {
      code: "PROVIDER_PLAN_ERROR",
      message: "API-Football paketi bu veri veya turnuva icin erisim vermiyor."
    };
  }

  if (/season|date|no results|not found/.test(text)) {
    return {
      code: "PROVIDER_DATA_UNAVAILABLE",
      message: "API-Football istenen tarih veya sezon icin veri dondurmedi."
    };
  }

  return {
    code: "PROVIDER_RESPONSE_ERROR",
    message: "Live provider kontrollu bir veri hatasi dondu."
  };
}

/**
 * Uç nokta → önbellek kaynağı eşlemesi.
 *
 * BİTMİŞ bir maçın dökümü DEĞİŞMEZ: olaylar, kadrolar, istatistikler ve
 * oyuncu istatistikleri son düdükten sonra sabittir. Bu yüzden fikstür
 * detay uç noktaları uzun TTL alır; aynı maç aynı koşuda ya da art arda
 * koşularda ikinci kez sorulmaz.
 */
const CACHE_RESOURCE_BY_PATH = Object.freeze({
  "/fixtures/lineups": "match-detail",
  "/fixtures/events": "match-detail",
  "/fixtures/statistics": "match-detail",
  // OYUNCU İSTATİSTİĞİNİN KENDİ KOVASI VAR.
  //
  // Maç detayının geri kalanı 30 saniyede tazeleniyor (skor ve olaylar o
  // hızda değişiyor). Oyuncu dereceleri o hızda değişmiyor ama her
  // tazelemede ikinci bir sağlayıcı isteği demek olurdu — canlı maç başına
  // kota iki katına çıkardı. Ayrı ve uzun TTL, yükü dakikada bir isteğin
  // altına indiriyor.
  "/fixtures/players": "match-players",
  "/predictions": "match-detail",
  // Oran ve sezonluk takım istatistiği maç öncesi verilerdir: dakikalık
  // değil saatlik ölçekte değişirler. Kısa TTL vermek, aynı koşuda aynı
  // fikstürü iki kez sormak demek olurdu.
  "/odds": "pre-match-odds",
  "/teams/statistics": "team-statistics",
  "/fixtures": "matches",
  "/standings": "standings",
  "/players": "players",
  "/teams": "teams"
});

/**
 * Önbellek kaynağını YOL VE PARAMETREden birlikte seçer.
 *
 * Canlı skor yoklaması da "/fixtures" yoluna gidiyor (`?live=all`). Yalnızca
 * yola bakan bir eşleme, canlı sorguya günlük listenin 60 saniyelik TTL'ini
 * verirdi ve skorlar bir dakikaya kadar bayat kalırdı. Canlı sorgu kendi
 * kısa TTL'ini (matches-live, 15 sn) alır.
 */
function cacheResourceFor(path, params) {
  if (path === "/fixtures" && params && params.live) {
    return "matches-live";
  }

  // Tek fikstür kimliğiyle sorgu — mac-detay.html ve /api/live-latency bu
  // yoldan geçiyor ve ikisi de o TEK maçın güncel durumunu istiyor.
  // Eşleme yalnızca yola bakıyorduysa bu da günlük listenin 60 sn TTL'ini
  // alıyordu: canlı bir maçın detay sayfası CDN/istemci tazeyken sağlayıcı
  // katmanında bir dakikaya kadar bayat kalabiliyordu.
  if (path === "/fixtures" && params && params.id) {
    return "matches-live";
  }

  return CACHE_RESOURCE_BY_PATH[path];
}

/** Koşu boyunca gerçekten ağa çıkan istek sayısı (önbellek isabetleri hariç). */
const requestCounter = { total: 0, byPath: Object.create(null), cacheHits: 0 };

function countRequest(path) {
  requestCounter.total += 1;
  requestCounter.byPath[path] = (requestCounter.byPath[path] || 0) + 1;
}

function providerRequestStats() {
  return {
    total: requestCounter.total,
    byPath: { ...requestCounter.byPath },
    cacheHits: requestCounter.cacheHits
  };
}

function resetProviderRequestStats() {
  requestCounter.total = 0;
  requestCounter.cacheHits = 0;
  requestCounter.byPath = Object.create(null);
}

/**
 * SAĞLAYICI KOTASININ SON BİLİNEN DURUMU.
 *
 * `requestCounter` yalnızca BU koşuda yapılan istekleri sayar; gün içinde
 * daha önce çalışmış adımların harcadığı kotayı bilmez. Kota ise günlük ve
 * hesap genelindedir. Uzun toplu işler (18 takımlık sayfalı oyuncu çekimi
 * gibi) bu yüzden yerel sayaca güvenerek duramaz — kotanın gerçekte ne kadar
 * kaldığını yalnızca sağlayıcının yanıt başlıkları söyler.
 *
 * `x-ratelimit-requests-*` GÜNLÜK kotadır ve toplu işleri durduran ölçü odur.
 * `x-ratelimit-*` (ön ek yok) dakikalık penceredir; ayrı alanlarda tutulur
 * çünkü ikisini karıştırmak "kota bitti" diye erken durmak demektir.
 *
 * Değerler null ise kota BİLİNMİYOR demektir (henüz ağa çıkılmadı ya da
 * yanıt önbellekten geldi). Bilinmeyen kotayı "bitti" saymak, çalışan bir
 * adımı sebepsiz durdurmak olurdu; çağıran taraf null'ı "durma" olarak
 * yorumlamalıdır.
 */
const rateLimitState = {
  limit: null,
  remaining: null,
  minuteLimit: null,
  minuteRemaining: null,
  observedAt: null
};

function headerNumber(headers, name) {
  const raw = headers && typeof headers.get === "function" ? headers.get(name) : null;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function recordRateLimit(headers) {
  const limit = headerNumber(headers, "x-ratelimit-requests-limit");
  const remaining = headerNumber(headers, "x-ratelimit-requests-remaining");
  const minuteLimit = headerNumber(headers, "x-ratelimit-limit");
  const minuteRemaining = headerNumber(headers, "x-ratelimit-remaining");
  if (limit === null && remaining === null && minuteLimit === null && minuteRemaining === null) {
    return;
  }
  if (limit !== null) rateLimitState.limit = limit;
  if (remaining !== null) rateLimitState.remaining = remaining;
  if (minuteLimit !== null) rateLimitState.minuteLimit = minuteLimit;
  if (minuteRemaining !== null) rateLimitState.minuteRemaining = minuteRemaining;
  rateLimitState.observedAt = new Date().toISOString();
}

function getProviderRateLimit() {
  return { ...rateLimitState };
}

/**
 * Önbellekli sağlayıcı çağrısı.
 *
 * services/providerCache.js yazılmıştı ama HİÇBİR ÇAĞRI YERİ ONU
 * KULLANMIYORDU — ölü koddu. TTL, tek uçuş (aynı anahtar için eşzamanlı N
 * istek tek çağrıya iner) ve hatada bayat servis bu yüzden hiç devreye
 * girmiyordu; her çağrı doğrudan ağa çıkıyor ve kotayı harcıyordu.
 */
const payloadFetchedAt = new WeakMap();

async function providerFetch(path, params, options = {}) {
  const resource = cacheResourceFor(path, params);
  const fetchFresh = async () => {
    const payload = await providerFetchUncached(path, params);
    if (payload && typeof payload === "object") payloadFetchedAt.set(payload, new Date().toISOString());
    return payload;
  };

  if (!resource || options.fresh) {
    return fetchFresh();
  }

  const mode=modeFor({requested:operationsConfig.mode,rateLimit:rateLimitState});
  const result = await fetchWithCache(resource, { path, ...params }, fetchFresh,
    mode==='saving' ? {ttlMs:Math.max(60000,ttlFor(resource)*2)} : {});

  if (result.cache === "hit" || result.cache === "coalesced") {
    requestCounter.cacheHits += 1;
  }

  if (path === "/fixtures" && result.cache === "stale" && !responseItems(result.data).length) throw result.error;
  return result.data;
}

async function providerFetchUncached(path, params) {
  if(modeFor({requested:operationsConfig.mode,rateLimit:rateLimitState})==='protected') {
    throw new ProviderError('PROVIDER_RATE_LIMIT','Korumalı çalışma: sağlayıcı çağrıları durduruldu; son doğrulanmış veri korunuyor.');
  }
  countRequest(path);
  const config = assertConfig();
  const candidates = apiKeyCandidates();
  // Doğrulanmış anahtar varsa yalnızca onu kullan; yoksa adayları sırayla
  // dene. Yalnızca kimlik hatasında sıradakine geçilir - plan, limit ya da
  // veri hataları anahtarla ilgili değildir ve tekrar denemek kotayı boşa
  // harcar.
  const attemptKeys = activeApiKey && candidates.includes(activeApiKey) ? [activeApiKey] : candidates;
  let lastError = null;

  for (const apiKey of attemptKeys) {
    try {
      const payload = await providerFetchWithKey(path, params, apiKey, config);
      activeApiKey = apiKey;
      return payload;
    } catch (error) {
      lastError = error;
      if (error.code !== "PROVIDER_AUTH_ERROR") {
        throw error;
      }
      if (activeApiKey === apiKey) {
        activeApiKey = null;
      }
    }
  }

  throw lastError || new ProviderError("PROVIDER_CONFIG_MISSING", "API-Football provider icin gecerli bir anahtar bulunamadi.");
}

/**
 * Yeniden denenebilir hatalar: yalnızca GEÇİCİ olanlar.
 *
 * Kimlik, plan ve limit hataları tekrar denemekle düzelmez — üstelik limit
 * hatasında yeniden denemek kotayı daha da yakar. Zaman aşımı, bağlantı
 * kopması ve 5xx ise çoğu zaman bir sonraki denemede geçer; bu maçların
 * sayfadan kaybolmasının sessiz sebeplerinden biriydi.
 */
const RETRYABLE_CODES = new Set(["PROVIDER_HTTP_ERROR", "PROVIDER_TIMEOUT", "PROVIDER_NETWORK_ERROR"]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;
/** Sayfalı çekimde ardışık istekler arası nefes; dakikalık pencereyi korur. */
const PAGINATION_DELAY_MS = 250;

function isRetryable(error) {
  if (!error) return false;
  if (RETRYABLE_CODES.has(error.code)) {
    // 4xx bir istemci hatası; tekrar denemek aynı yanıtı getirir.
    return !error.statusCode || error.statusCode >= 500 || error.statusCode === 408;
  }
  // withTimeout ve fetch'in kendi hataları ProviderError olmayabilir.
  return error.name === "AbortError" || error.name === "TimeoutError" || /timeout|network|socket|ECONN|fetch failed/i.test(String(error.message || ""));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function providerFetchWithKey(path, params, apiKey, config) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await providerFetchOnce(path, params, apiKey, config);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || !isRetryable(error)) throw error;
      // Üstel geri çekilme; anahtar hiçbir günlük satırına girmez.
      console.warn(`[futbolradar:provider-retry] path=${path} attempt=${attempt}/${MAX_ATTEMPTS} ` +
        `code=${error.code || error.name || "unknown"}`);
      await delay(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }

  throw lastError;
}

async function providerFetchOnce(path, params, apiKey, config) {
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL(String(path).replace(/^\/+/, ""), baseUrl);

  Object.entries(compactParams(params)).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const signal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const request = fetch(url, {
    signal,
    headers: {
      accept: "application/json",
      "x-apisports-key": apiKey
    }
  }).then(async (response) => {
    // Kota başlıkları hata yanıtlarında da gelir; hatta asıl önemli oldukları
    // an odur. Bu yüzden `response.ok` denetiminden ÖNCE okunuyor.
    recordRateLimit(response.headers);
    rateLimitState.httpStatus = response.status;

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      payload = null;
    }

    if (!response.ok) {
      const code = mapHttpError(response.status);
      throw new ProviderError(
        code,
        publicErrorMessage(code, response.status),
        response.status,
        payload
      );
    }

    const errors = apiErrors(payload);
    if (errors.length) {
      const classified = classifyPayloadError(errors);
      throw new ProviderError(classified.code, classified.message, response.status, payload);
    }

    return payload || {};
  });

  return withTimeout(request, DEFAULT_TIMEOUT_MS);
}

/**
 * İzin verici çözümleme: lig kimliği YOKSA boş döner ve çağıran uç nokta
 * ligsiz (daha geniş) sorgu yapar. /teams ve /players arama davranışı buna
 * dayanıyor, bu yüzden burada önbellek katmanı KULLANILMAZ — kullanılsaydı
 * bu uç noktalar sessizce tek lige daraltılırdı.
 */
function resolveLeague(value) {
  const config = getConfig();
  return value || config.leagueId || "";
}

function resolveSeason(value, dateHint) {
  const config = getConfig();
  return value || config.season || seasonForDate(dateHint);
}

function todayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/**
 * BAŞLAMA SAATİ HER ZAMAN TSİ OFSETİYLE YAZILIR.
 *
 * API-Football `fixture.date` alanını UTC ofsetiyle ("...T22:30:00+00:00")
 * döndürüyor. Zincirin tamamı ise takvim gününü ISO dizesinin ilk on
 * karakterinden okuyor (`app.js:matchDateValue`, `sync-live-fixtures.mjs`,
 * `prerender-core-pages.mjs`, `services/dailyHeadlines.js` ...). Aynı kural
 * `scripts/sync-fixture-calendar.mjs` içinde de yazılı: TheSportsDB zaman
 * damgası TSİ'ye çevrildikten sonra saklanır, "böylece tarih
 * karşılaştırmaları doğru güne düşer".
 *
 * Bu sağlayıcı o sözleşmenin dışında kalmıştı. Sonucu bir GÜNLÜK KAYMA:
 * TSİ 21:00'den sonra başlayan her maç (UTC'de ertesi gün değil, aynı gün
 * 21:00+ olanlar değil — UTC 21:00'i geçenler) bir önceki güne düşüyordu.
 * "2026-08-10T22:30:00+00:00" TSİ'de 11 Ağustos 01:30'dur; dosyada ise
 * 10 Ağustos maçı gibi duruyordu ve "Bugünün Maçları" onu yanlış güne
 * koyuyordu.
 *
 * Aynı ANDIR, yalnızca gösterimi değişir: `Date.parse` iki biçim için de
 * aynı değeri verir, değişen tek şey dizeyi dilimleyen kodun gördüğü gün.
 */
function toIstanbulOffsetIso(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    // Çözümlenemeyen değer UYDURULMAZ; sağlayıcının yazdığı gibi taşınır.
    return raw;
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(parsed).map((part) => [part.type, part.value])
  );

  // Intl gece yarısını "24" olarak verebiliyor; gün zaten doğru olduğu için
  // yalnızca saat alanı normalize edilir.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}+03:00`;
}

function responseItems(payload) {
  return Array.isArray(payload && payload.response) ? payload.response : [];
}

function teamName(team) {
  return team && (team.name || team.shortName || team.code) || "";
}

function teamLogo(team) {
  return (team && team.logo) || "";
}

function teamId(team) {
  return team && team.id !== undefined && team.id !== null ? String(team.id) : null;
}

function scoreValue(score) {
  return score === undefined || score === null ? null : score;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

function numberOrNull(value) {
  const candidate = firstDefined(value);
  if (candidate === null) {
    return null;
  }

  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}

function stampProviderData(records, resource, staleAfterMs, payload) {
  const fetchedAt = payloadFetchedAt.get(payload) || new Date().toISOString();
  const staleAfter = new Date(Date.parse(fetchedAt) + staleAfterMs).toISOString();
  return records.map((record) => ({
    ...record,
    source: "api-football",
    providerName: "api-football",
    fetchedAt,
    staleAfter,
    dataStatus: "provider",
    needsReview: false,
    resource
  }));
}

/**
 * Saglayici kisa kodunu kanonik duruma cevirir.
 *
 * Eskiden tanimli olmayan HER kod "SCHEDULED" donuyordu: PST (ertelendi),
 * CANC (iptal), ABD (tatil), SUSP/INT (ara verildi), AWD/WO (hukmen) ve
 * TBD hepsi "programlandi" goruluyordu. Baslama saati gectigi icin arayuz
 * bunlari oynanmakta olan mac bandina aliyordu - OYNANMAYAN BIR MAC CANLI
 * GIBI GORUNUYORDU. Sozluk artik services/matchStatus.js'de tek yerde.
 */
function normalizeStatus(status) {
  const short = status && status.short;
  const state = canonicalStatus(short);

  // Bilinmeyen kod uydurulmaz: "SCHEDULED" demek yerine kaydin durumu
  // bilinmiyor olarak tasinir ve arayuz bunu yazar.
  return state;
}

function roundNumber(league) {
  // API-Football rounds read like "Regular Season - 3"; only the trailing
  // number is ever used (grouping matches into weeks), never the label text.
  const match = String((league && league.round) || "").match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function normalizeFixture(item) {
  const fixture = item.fixture || {};
  const league = item.league || {};
  const competition = findCompetitionByProviderId(league.id);
  const teams = item.teams || {};
  const goals = item.goals || {};
  const kickoff = toIstanbulOffsetIso(fixture.date);
  const homeTeam = teams.home || {};
  const awayTeam = teams.away || {};

  return {
    id: String(fixture.id || `${teamName(homeTeam)}-${teamName(awayTeam)}-${kickoff}`),
    providerId: fixture.id ? String(fixture.id) : "",
    league: competition ? competition.name : league.name || "",
    competitionId: competition ? competition.id : null,
    // Sağlayıcının SAYISAL lig kimliği. Aşağı akıştaki her eşleşme
    // (filterSupportedCompetitions, groupMatchesByLeague, competitionId
    // çözümü) önce bunu dener — ad hiçbir zaman tek başına karar vermez.
    // bkz. services/competitionCatalog.js: findCompetitionByProviderId.
    providerLeagueId: league.id === undefined || league.id === null ? null : String(league.id),
    // Ülke YALNIZCA aynı adlı başka ülke ligi için taşınır ("Ligue 1" Fransa
    // değil Cezayir); diğer kayıtların biçimi değişmez.
    ...(!competition && league.country && isForeignNamesake({ league: league.name, providerLeagueId: league.id }, "")
      ? { leagueCountry: String(league.country) }
      : {}),
    round: roundNumber(league),
    venue: (fixture.venue && fixture.venue.name) || null,
    // Hakem adı sağlayıcı fikstür yükünde hazır geliyordu ama düşürülüyordu;
    // maç bilgi kartı (stadyum/hakem/saat) bu alanı okur. Açıklanmadıysa null.
    referee: fixture.referee || null,
    kickoff,
    time: kickoff ? new Date(kickoff).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "",
    homeTeam: teamName(homeTeam),
    awayTeam: teamName(awayTeam),
    // SAĞLAYICI TAKIM KİMLİĞİ. Ad sağlayıcıdan sağlayıcıya ("Beşiktaş" /
    // "Besiktas JK") değişiyor; canlı puan durumu maçı doğru satıra ancak
    // kimlikle bağlayabiliyor (bkz. services/liveStandings.js#findRow).
    // Kimlik yoksa alan null kalır — ad eşleşmesine düşülür, uydurulmaz.
    homeTeamId: teamId(homeTeam),
    awayTeamId: teamId(awayTeam),
    homeTeamLogo: teamLogo(homeTeam),
    awayTeamLogo: teamLogo(awayTeam),
    status: normalizeStatus(fixture.status || {}),
    providerStatus: (fixture.status && fixture.status.short) || null,
    // Oynanan dakika yalnizca olay akisinda okunuyordu; maca ait `elapsed`
    // hic alinmadigi icin canli kartlarda dakika bos kaliyor, istemci de
    // baslama saatini ("21:00") dakika sanip gostermiyordu.
    minute: fixture.status && fixture.status.elapsed != null ? Number(fixture.status.elapsed) : null,
    elapsed: fixture.status && fixture.status.elapsed != null ? Number(fixture.status.elapsed) : null,
    live: ["LIVE", "HALFTIME"].includes(normalizeStatus(fixture.status || {})),
    score: {
      home: scoreValue(goals.home),
      away: scoreValue(goals.away)
    },
    homeForm: null,
    awayForm: null,
    homeMomentum: null,
    awayMomentum: null,
    momentum: { side: "neutral", value: null },
    aiPrediction: null,
    goalExpectation: null,
    goalPotential: null,
    risk: null,
    // `/fixtures?live=...` already embeds events. Reusing them avoids one
    // `/fixtures/events` provider request per live match and preserves quota.
    events: normalizeFixtureEvents(item.events),
    source: "api-football"
  };
}

/**
 * BİR FİKSTÜR KATALOGDAKİ BİR YARIŞMAYLA EŞLEŞİYOR MU?
 *
 * `providerLeagueId` doluysa (API-Football fikstürleri için her zaman
 * öyledir) eşleşme YALNIZCA sayısal kimlikle kurulur — ad hiç okunmaz.
 * Kimlik yoksa (ör. TheSportsDB kaynaklı kayıtlar) eskisi gibi ada göre
 * karar verilir. Bu ayrım, "Premier League" gibi bir adın başka bir
 * yarışmaya yanlışlıkla bağlanmasını (ya da tersini) imkânsız kılar: kimlik
 * varken ad hiçbir zaman kimliği ezemez.
 */
function competitionMatchesFixture(match, competition) {
  if (match && match.providerLeagueId) {
    const declared = competition.providers && competition.providers.apiFootball;
    if (declared !== null && declared !== undefined) {
      return String(declared) === String(match.providerLeagueId);
    }
    // Katalogdaki yarışmanın henüz doğrulanmış bir API-Football kimliği yok
    // (ör. çözüm bekleyen yeni bir lig) — kimlik taşıyan bir fikstürü ada
    // göre bu kayda bağlamak, tam da önlemeye çalıştığımız tahmin olurdu.
    return false;
  }
  return matchesCompetition(match && match.league, competition);
}

function filterSupportedCompetitions(matches) {
  return (Array.isArray(matches) ? matches : []).filter((match) =>
    competitions.some((competition) => competitionMatchesFixture(match, competition))
  );
}

function normalizeStandingRow(row, leagueName) {
  const team = row.team || {};
  return {
    id: String(team.id || team.name || ""),
    providerId: team.id ? String(team.id) : "",
    rank: numberOrNull(row.rank),
    team: teamName(team),
    name: teamName(team),
    logo: teamLogo(team),
    league: leagueName || "",
    group: row.group || null,
    played: numberOrNull(row.all && row.all.played),
    won: numberOrNull(row.all && row.all.win),
    drawn: numberOrNull(row.all && row.all.draw),
    lost: numberOrNull(row.all && row.all.lose),
    goalsFor: numberOrNull(row.all && row.all.goals && row.all.goals.for),
    goalsAgainst: numberOrNull(row.all && row.all.goals && row.all.goals.against),
    goalDifference: numberOrNull(row.goalsDiff),
    points: numberOrNull(row.points),
    average: numberOrNull(row.goalsDiff),
    momentum: null,
    formScore: null,
    form: row.form ? String(row.form).split("").slice(-5) : [],
    source: "api-football"
  };
}

function normalizeTeam(item) {
  const team = item.team || {};
  const venue = item.venue || {};
  return {
    id: String(team.id || team.name || ""),
    providerId: team.id ? String(team.id) : "",
    name: teamName(team),
    shortName: team.code || "",
    logo: team.logo || null,
    league: "",
    country: team.country || "",
    venue: venue.name || null,
    coach: null,
    squadCount: null,
    momentum: null,
    rating: null,
    attackRating: null,
    defenseRating: null,
    source: "api-football"
  };
}

function normalizeSquadPlayer(item, team) {
  return {
    id: String(item.id || item.name || ""),
    providerId: item.id ? String(item.id) : "",
    name: item.name || "",
    currentTeam: teamName(team),
    team: teamName(team),
    position: item.position || "",
    age: item.age || null,
    shirtNumber: numberOrNull(item.number),
    photo: item.photo || null,
    dataStatus: "provider",
    ratingStatus: "pending",
    source: "api-football"
  };
}

function firstStatistic(item) {
  return Array.isArray(item.statistics) && item.statistics[0] ? item.statistics[0] : {};
}

function sumOrNull(values) {
  const numbers = values.map(numberOrNull).filter((value) => value !== null);
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null;
}

/**
 * Bir oyuncunun sezon istatistikleri API-Football'da turnuva başına ayrı
 * bloklar hâlinde gelir (lig, kupa, Avrupa). Yalnızca ilk bloğu okumak
 * oyuncunun üretiminin bir kısmını görünmez yapıyordu; bu yüzden tüm
 * bloklar toplanır. Reyting toplanamaz, oynanan dakikaya göre ağırlıklı
 * ortalaması alınır.
 */
function aggregateStatistics(statistics) {
  const blocks = Array.isArray(statistics) ? statistics.filter(Boolean) : [];
  const pick = (path) => blocks.map((block) => {
    return path.reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), block);
  });
  const minutesPerBlock = blocks.map((block) => numberOrNull(block.games && block.games.minutes) || 0);
  const ratings = blocks.map((block) => numberOrNull(block.games && block.games.rating));
  const ratingWeight = ratings.reduce((total, rating, index) => total + (rating === null ? 0 : minutesPerBlock[index] || 1), 0);
  const ratingTotal = ratings.reduce((total, rating, index) => total + (rating === null ? 0 : rating * (minutesPerBlock[index] || 1)), 0);
  const passAccuracyValues = pick(["passes", "accuracy"]).map(numberOrNull).filter((value) => value !== null && value <= 100);

  return {
    appearances: sumOrNull(pick(["games", "appearences"]).concat(pick(["games", "appearances"]))),
    starts: sumOrNull(pick(["games", "lineups"])),
    minutes: sumOrNull(pick(["games", "minutes"])),
    goals: sumOrNull(pick(["goals", "total"])),
    assists: sumOrNull(pick(["goals", "assists"])),
    goalsConceded: sumOrNull(pick(["goals", "conceded"])),
    saves: sumOrNull(pick(["goals", "saves"])),
    shots: sumOrNull(pick(["shots", "total"])),
    shotsOnTarget: sumOrNull(pick(["shots", "on"])),
    passes: sumOrNull(pick(["passes", "total"])),
    keyPasses: sumOrNull(pick(["passes", "key"])),
    // `accuracy` yüzde olarak gelir; blok başına ortalaması alınır.
    passAccuracy: passAccuracyValues.length
      ? Math.round(passAccuracyValues.reduce((total, value) => total + value, 0) / passAccuracyValues.length)
      : null,
    tackles: sumOrNull(pick(["tackles", "total"])),
    blocks: sumOrNull(pick(["tackles", "blocks"])),
    interceptions: sumOrNull(pick(["tackles", "interceptions"])),
    duelsTotal: sumOrNull(pick(["duels", "total"])),
    duelsWon: sumOrNull(pick(["duels", "won"])),
    dribbleAttempts: sumOrNull(pick(["dribbles", "attempts"])),
    dribbles: sumOrNull(pick(["dribbles", "success"])),
    foulsCommitted: sumOrNull(pick(["fouls", "committed"]).concat(pick(["fouls", "commited"]))),
    yellowCards: sumOrNull(pick(["cards", "yellow"])),
    redCards: sumOrNull(pick(["cards", "red"]).concat(pick(["cards", "yellowred"]))),
    rating: ratingWeight ? Math.round((ratingTotal / ratingWeight) * 100) / 100 : null
  };
}

function normalizePlayer(item, expectedSeason) {
  const player = item.player || item;
  const statistics = Array.isArray(item.statistics) && item.statistics.length ? item.statistics : [firstStatistic(item)];
  const seasonStatistics = buildSeasonSnapshot(item, expectedSeason);
  const scoped = seasonStatistics ? statistics.filter(block => String(block.league?.season) === seasonStatistics.season) : statistics;
  const primary = scoped[0] || {};
  const team = primary.team || item.team || {};
  const games = primary.games || {};
  const aggregated = aggregateStatistics(scoped);
  const seasonStatisticsRejected = expectedSeason != null && !seasonStatistics;
  const stats = seasonStatistics ? seasonStatistics.stats : seasonStatisticsRejected ? {} : aggregated;
  const rating = aggregated.rating;
  const shirtNumber = numberOrNull(games.number);

  return {
    id: String(player.id || player.name || ""),
    providerId: player.id ? String(player.id) : "",
    providerName: "api-football",
    name: player.name || "",
    fullName: [player.firstname, player.lastname].filter(Boolean).join(" ") || player.name || "",
    currentTeam: teamName(team),
    team: teamName(team),
    // Sağlayıcı takım kimliği; maç bazlı performans sorgusu takım kimliği
    // olmadan yapılamıyor (oyuncu maç geçmişi uç noktası yok).
    currentTeamProviderId: team && team.id ? String(team.id) : null,
    formerTeams: [],
    league: (primary.league && primary.league.name) || "",
    position: games.position || player.position || "",
    birthDate: player.birth && player.birth.date || null,
    computedAge: player.age || null,
    age: player.age || null,
    nationality: player.nationality || null,
    height: player.height || null,
    weight: player.weight || null,
    injured: typeof player.injured === "boolean" ? player.injured : null,
    shirtNumber,
    // Piyasa değeri ve sözleşme API-Football kapsamında yok; alan bilinçli
    // olarak boş bırakılır ki UI tahmini bir rakam göstermesin.
    marketValueEur: null,
    contractUntil: null,
    photo: player.photo || null,
    stats,
    seasonStatistics,
    seasonStatisticsRejected,
    ...(seasonStatistics ? { season: seasonStatistics.season, statsSource: "API-Football",
      statsVerifiedFields: [...Object.keys(seasonStatistics.evidence), ...(stats.minutes === null ? [] : ["minutesPlayed"])] } : {}),
    appearances: stats.appearances,
    minutesPlayed: stats.minutes,
    minutes: stats.minutes,
    goals: stats.goals,
    assists: stats.assists,
    shots: stats.shots,
    keyPasses: stats.keyPasses,
    passAccuracy: stats.passAccuracy,
    duelsWon: stats.duelsWon,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
    // 0-10 ölçeğindeki maç reytingi rating modeline karışmasın diye ayrı
    // alanda taşınır; oyuncu skoru bu alanı "Puan" bileşeni olarak okur.
    providerRating: rating,
    matchRating: rating,
    transferHistory: [],
    dataStatus: "provider",
    ratingStatus: rating == null ? "pending" : "provider",
    transferUpdatedAt: null,
    source: "api-football",
    lastSyncedAt: firstDefined(item.lastSyncedAt, item.fetchedAt)
  };
}

/**
 * Sağlayıcı bazı transfer kayıtlarında tarih veya varış kulübünü BOŞ döner
 * (örn. serbest kalış/kayıp belge). Böyle bir kaydı olduğu gibi geçirmek
 * `validatePlayerData`in "transferHistory[i] date ve toTeam içermeli"
 * kuralını kırar ve senkron adımını tamamen düşürür — tek eksik kayıt için
 * bütün koşu kaybedilir. Doğru davranış eksik kaydı sessizce ATLAMAK: diğer
 * transferler ve profil zenginleştirmesi etkilenmeden ilerler.
 */
function fixturePlayerStats(row) {
  const block = Array.isArray(row.statistics) && row.statistics[0] ? row.statistics[0] : {};
  const games = block.games || {};
  const goals = block.goals || {};
  const passes = block.passes || {};
  const passAccuracy = numberOrNull(passes.accuracy);

  return {
    minutes: numberOrNull(games.minutes),
    rating: numberOrNull(games.rating),
    started: games.substitute === undefined ? null : games.substitute === false,
    shirtNumber: numberOrNull(games.number),
    position: games.position || null,
    goals: numberOrNull(goals.total),
    assists: numberOrNull(goals.assists),
    saves: numberOrNull(goals.saves),
    goalsConceded: numberOrNull(goals.conceded),
    shots: numberOrNull(block.shots && block.shots.total),
    shotsOnTarget: numberOrNull(block.shots && block.shots.on),
    keyPasses: numberOrNull(passes.key),
    // Maç bazlı yanıtta `accuracy` bazen isabetli pas sayısı olarak gelir;
    // 100'ü aşan değer yüzde değildir ve yüzde alanına yazılmaz.
    passAccuracy: passAccuracy !== null && passAccuracy <= 100 ? passAccuracy : null,
    dribbles: numberOrNull(block.dribbles && block.dribbles.success),
    duelsWon: numberOrNull(block.duels && block.duels.won),
    tackles: numberOrNull(block.tackles && block.tackles.total),
    interceptions: numberOrNull(block.tackles && block.tackles.interceptions)
  };
}

/**
 * Bir oyuncunun son N maçındaki bireysel istatistikleri.
 *
 * API-Football'da oyuncu bazlı maç geçmişi uç noktası yok; takımın son
 * maçları çekilir ve her fikstürün oyuncu istatistiklerinden ilgili satır
 * ayıklanır. İstek sayısı bu yüzden maç sayısıyla sınırlıdır (en fazla 10)
 * ve yanıt uzun süreli önbelleğe alınır.
 */
async function getPlayerMatchLog(query) {
  const playerId = query && (query.playerId || query.id);
  const teamId = query && query.teamId;

  if (!playerId || !teamId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Mac performansi icin playerId ve teamId query gerekli.");
  }

  const last = Math.max(1, Math.min(Number(query.last) || 5, 10));
  const fixturesPayload = await providerFetch("/fixtures", compactParams({ team: teamId, last, status: "FT-AET-PEN" }));
  const fixtures = responseItems(fixturesPayload);

  const entries = await Promise.all(fixtures.map(async (item) => {
    const fixture = item.fixture || {};
    if (!fixture.id) {
      return null;
    }

    let payload = null;
    try {
      payload = await providerFetch("/fixtures/players", { fixture: fixture.id });
    } catch (error) {
      return null;
    }

    const teams = responseItems(payload);
    const teamBlock = teams.find((block) => String(block.team && block.team.id) === String(teamId));
    const row = (teamBlock && Array.isArray(teamBlock.players) ? teamBlock.players : [])
      .find((entry) => String(entry.player && entry.player.id) === String(playerId));

    if (!row) {
      return null;
    }

    const home = (item.teams && item.teams.home) || {};
    const away = (item.teams && item.teams.away) || {};
    const isHome = String(home.id) === String(teamId);
    const goals = item.goals || {};

    return {
      fixtureId: String(fixture.id),
      date: fixture.date || null,
      competition: (item.league && item.league.name) || null,
      opponent: isHome ? teamName(away) : teamName(home),
      venue: isHome ? "home" : "away",
      teamGoals: numberOrNull(isHome ? goals.home : goals.away),
      opponentGoals: numberOrNull(isHome ? goals.away : goals.home),
      ...fixturePlayerStats(row)
    };
  }));

  return entries.filter(Boolean);
}

/**
 * Kadro kaydı: forma numarası yalnızca /players/squads yanıtında bulunur.
 */
async function getSquadEntry(query) {
  const teamId = query && query.teamId;
  const playerId = query && (query.playerId || query.id);

  if (!teamId || !playerId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Kadro kaydi icin teamId ve playerId query gerekli.");
  }

  const payload = await providerFetch("/players/squads", { team: teamId });
  const item = responseItems(payload)[0] || {};
  const squad = Array.isArray(item.players) ? item.players : [];
  const entry = squad.find((player) => String(player.id) === String(playerId));

  return entry
    ? { id: String(entry.id), name: entry.name || "", number: numberOrNull(entry.number), position: entry.position || null, photo: entry.photo || null }
    : null;
}

/**
 * Gol/asist krallığı satırı — `normalizePlayer`den KASITLI olarak ayrı.
 *
 * `/players/topscorers` ve `/players/topassists` zaten `league`+`season`
 * parametreleriyle TEK ligi sorgular; dönen `statistics` blokları bu yüzden
 * hepsi aynı ligdendir (yalnızca sezon içi takım değişikliğinde birden
 * fazla blok olur). `normalizePlayer`in `aggregateStatistics`i ise genel
 * `/players` uç noktası için yazılmıştı ve TÜM turnuvaları (kupa, Avrupa)
 * toplar — krallık tablosu için burada kullanılırsa lig dışı gol/asist
 * karışır. Bu fonksiyon yalnızca ligin kendi bloklarını toplar ve son
 * bloğun takımını (sezon içi transferde güncel kulüp) gösterir.
 */
function normalizeLeagueLeaderEntry(item) {
  const player = item.player || {};
  const blocks = Array.isArray(item.statistics) ? item.statistics.filter(Boolean) : [];
  const lastBlock = blocks[blocks.length - 1] || {};
  const team = lastBlock.team || {};

  return {
    providerId: player.id ? String(player.id) : "",
    name: player.name || "",
    photo: player.photo || null,
    team: teamName(team),
    teamLogo: team.logo || null,
    teamProviderId: team.id ? String(team.id) : null,
    league: (lastBlock.league && lastBlock.league.name) || "",
    // Lig ADI değil, lig KİMLİĞİ doğrulama ölçütüdür: "Premier League" adı
    // birden çok ülkede var, kimlik çakışmaz. Krallık tablosu satırları bu
    // alanla lig+sezon anahtarına bağlanır (services/competitionLeaders.js).
    leagueId: (lastBlock.league && lastBlock.league.id) ? String(lastBlock.league.id) : null,
    season: (lastBlock.league && lastBlock.league.season) ? String(lastBlock.league.season) : null,
    appearances: sumOrNull(blocks.map((block) => numberOrNull(block.games && (block.games.appearences ?? block.games.appearances)))) || 0,
    minutes: sumOrNull(blocks.map((block) => numberOrNull(block.games && block.games.minutes))) || 0,
    goals: sumOrNull(blocks.map((block) => numberOrNull(block.goals && block.goals.total))) || 0,
    assists: sumOrNull(blocks.map((block) => numberOrNull(block.goals && block.goals.assists))) || 0
  };
}

function normalizeTransfer(item) {
  const player = item.player || {};
  const transfers = Array.isArray(item.transfers) ? item.transfers : [];
  return transfers
    .map((transfer, index) => {
      const teams = transfer.teams || {};
      const fromTeam = teams.out || {};
      const toTeam = teams.in || {};
      const date = transfer.date || null;
      return {
        id: String(`${player.id || player.name || "player"}-${date || index}-${teamName(toTeam)}`),
        playerId: player.id ? String(player.id) : "",
        playerName: player.name || "",
        date,
        season: date ? `${String(date).slice(0, 4)}/${String(Number(String(date).slice(2, 4)) + 1).padStart(2, "0")}` : null,
        fromTeam: teamName(fromTeam) || null,
        toTeam: teamName(toTeam) || null,
        type: transfer.type || null,
        fee: null,
        feeEur: null,
        marketValueEur: null,
        source: "api-football"
      };
    })
    .filter((transfer) => Boolean(transfer.date && transfer.toTeam));
}

/**
 * Ligin ZORUNLU olduğu uç noktalar (sezon fikstürü, puan durumu). İzin
 * verici resolveLeague'den farkı: burada boş bir kimlik hata demek, o yüzden
 * son çare olarak depoya commit edilmiş çözülmüş kimliğe bakılır.
 *
 * Katman yalnızca burada: /teams ve /players ligsiz sorguya izin veriyor ve
 * onları sessizce tek lige daraltmak, bu değişikliğin amacı dışında bir
 * davranış değişikliği olurdu.
 */
function ensureLeagueForData(params) {
  const league = resolveLeague(params && params.league);
  if (league) return league;

  const cached = readCachedLeague();
  if (cached && cached.leagueId) return cached.leagueId;

  throw new ProviderError("PROVIDER_QUERY_MISSING", "API-Football icin APIFOOTBALL_LEAGUE_ID veya league query gerekli.");
}

async function getFixtures(query) {
  const fixtureId = query && (query.fixtureId || query.id);
  const league = resolveLeague(query && query.league);
  const competition = query && (query.requestedCompetition || query.league)
    ? competitions.find((item) => matchesCompetition(query.requestedCompetition || query.league, item))
    : null;

  // Canlı skor için API-Football'ın gerçek zamanlı uç noktası "?live=all".
  // Tarih sorgusu da devam eden maçları döndürür ama daha seyrek tazelenir ve
  // her yoklamada günün tüm fikstürünü çekerek kotayı boşa harcar. Canlı
  // yoklama bu yüzden ayrı parametreyle sadece oynanan maçları ister.
  const live = query && query.live;
  const liveValue = live === true || live === "1" || live === "true" ? "all" : (live || null);
  const date = liveValue || fixtureId ? undefined : (query && query.date) || todayInIstanbul();

  const payload = await providerFetch("/fixtures", {
    id: fixtureId,
    date,
    timezone: "Europe/Istanbul",
    live: liveValue || undefined
  }, { fresh: Boolean(query && query.fresh) });
  if (!payload || !Array.isArray(payload.response)) throw new ProviderError("PROVIDER_RESPONSE_INVALID", "Fixture response is not an array.");
  const matches = responseItems(payload).map(normalizeFixture);
  // `live=all` gerçekten küresel canlı akıştır. Katalog filtresi burada
  // uygulanırsa sağlayıcı tüm maçları döndürse bile yalnızca FutbolRadar'ın
  // önceden tanıdığı ligler kalır. Editoryal öncelik sunum katmanının işi;
  // backend canlı kayıtlardan hiçbir ligi elemez.
  const supportedMatches = matches;
  const filteredMatches = query && query.league && !liveValue
    ? supportedMatches.filter((match) => competition ? competitionMatchesFixture(match, competition) : String(match.providerLeagueId) === String(query.league))
    : supportedMatches;
  return stampProviderData(filteredMatches, "matches", liveValue ? 90 * 1000 : 5 * 60 * 1000, payload);
}

async function getMatches(query) {
  const matches = await getFixtures(query);
  if (query && (query.live || query.id || query.fixtureId || (query.date && query.date !== todayInIstanbul()))) return matches;
  // The list and SSE stream read the same cached live provider response.
  const live = await getFixtures({ live: true }).catch(() => []);
  const byId = new Map(live.map(match => [match.providerId, match]));
  const dailyIds = new Set(matches.map(match=>match.providerId));
  return matches.map(match => {
    const current = byId.get(match.providerId);
    return current && !(match.status === "FINISHED" && Date.parse(match.fetchedAt) > Date.parse(current.fetchedAt)) ? current : match;
  }).concat(live.filter(match=>!dailyIds.has(match.providerId)));
}

/**
 * Full-season fixture list for one league (e.g. every Süper Lig matchday),
 * not just "today". API-Football's /fixtures endpoint returns the whole
 * season in a single unpaginated response when queried by league+season —
 * there is no page/limit parameter to raise here, and no client-side
 * slicing is applied to the result.
 */
async function getSeasonFixtures(query) {
  const league = ensureLeagueForData(query);
  const season = resolveSeason(query && query.season);
  const payload = await providerFetch("/fixtures", { league, season });
  const matches = responseItems(payload).map(normalizeFixture);
  return stampProviderData(matches, "season-fixtures", 60 * 60 * 1000, payload);
}

async function getStandings(query) {
  const league = ensureLeagueForData(query);
  const season = resolveSeason(query && query.season);
  const payload = await providerFetch("/standings", { league, season });
  const leaguePayload = responseItems(payload)[0] && responseItems(payload)[0].league || {};
  const table = Array.isArray(leaguePayload.standings) ? leaguePayload.standings.flat() : [];
  return stampProviderData(table.map((row) => ({ ...normalizeStandingRow(row, leaguePayload.name), season, leagueId: String(league) })), "standings", 60 * 60 * 1000, payload);
}

/**
 * Sağlayıcının lig kataloğu. Lig kimliği bilerek koda gömülmediği için
 * (docs/football-data-coverage.md), yapılandırılmamış bir kurulumda Süper
 * Lig'in kimliğini bulmanın tek dürüst yolu budur: sağlayıcıya sormak.
 *
 * Ham kayıtlar döner — hangi ligin aranan lig olduğuna karar vermek
 * services/leagueResolver.js'in işi, çünkü karar kuralı (isim eşleşmesi,
 * belirsizlik hâlinde durma) sağlayıcı ayrıntısı değil politika.
 */
async function getLeagues(query) {
  const payload = await providerFetch("/leagues", compactParams({
    id: query && query.id,
    name: query && query.name,
    country: query && query.country,
    season: query && query.season,
    type: query && query.type,
    current: query && query.current
  }));

  return responseItems(payload)
    .map((item) => {
      const league = (item && item.league) || {};
      const country = (item && item.country) || {};
      const seasons = Array.isArray(item && item.seasons) ? item.seasons : [];
      // Kayıt genelde ilgili sezon için sorgulanır (season param), o yüzden
      // "güncel" işaretli olan yerine SON gelen sezon esas alınır — bazı
      // paketler `current` bayrağını doğru döndürmüyor.
      const targetSeason = seasons.find((season) => season && season.current) || seasons[seasons.length - 1] || null;
      return {
        id: league.id === undefined || league.id === null ? null : String(league.id),
        name: league.name || "",
        type: league.type || "",
        country: country.name || "",
        logo: league.logo || null,
        seasons: seasons.map((season) => String(season && season.year)).filter(Boolean),
        currentSeasonYear: targetSeason ? String(targetSeason.year) : null,
        // Coverage nesnesi hangi modüllerin bu lig/sezon için desteklendiğini
        // söyler (fixtures.lineups, statistics, standings, players...).
        // Desteklenmeyen bir modülü render etmemek için ham hâliyle taşınır.
        coverage: targetSeason && targetSeason.coverage ? targetSeason.coverage : null
      };
    })
    .filter((league) => league.id && league.name);
}

async function getTeams(query) {
  const league = resolveLeague(query && query.league);
  const payload = await providerFetch("/teams", compactParams({
    league,
    season: resolveSeason(query && query.season),
    search: query && query.search,
    id: query && (query.teamId || query.id),
    country: query && query.country || getConfig().country
  }));
  return stampProviderData(responseItems(payload).map(normalizeTeam), "teams", 24 * 60 * 60 * 1000);
}

/**
 * ADA DÜNYA GENELİNDE TAKIM ARAR — Süper Lig'e daraltılmadan.
 *
 * `getTeams()` iki yerde sessizce Türkiye'ye kilitlenir: `resolveLeague`
 * ligi vermezsen `config.leagueId`'ye (Süper Lig) düşer, `country` da
 * vermezsen `config.country`'ye (Türkiye) düşer. Bu, `getTeams()`'i bir
 * Avrupa kupası rakibini bulmak için kullanılamaz kılar — sonuç sessizce
 * boş dönerdi ve "böyle bir takım yok" ile "yanlış ülkeye arandı" ayırt
 * edilemezdi. Bu fonksiyon `league`'e HİÇ dokunmaz, `country`'yi de yalnız
 * açıkça verilirse kullanır; aksi hâlde sağlayıcının global adı-arama
 * davranışına bırakılır.
 */
async function searchTeams(query) {
  const name = query && (query.name || query.search);
  if (!name) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Takım arama icin name/search gerekli.");
  }
  const payload = await providerFetch("/teams", compactParams({
    search: name,
    country: query && query.country
  }));
  return stampProviderData(responseItems(payload).map(normalizeTeam), "teams", 24 * 60 * 60 * 1000);
}

async function getSquad(query) {
  const teamId = query && query.teamId;
  if (!teamId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Kadro icin teamId query gerekli.");
  }

  const payload = await providerFetch("/players/squads", { team: teamId });
  const item = responseItems(payload)[0] || {};
  const team = item.team || {};
  const squad = Array.isArray(item.players) ? item.players : [];
  return stampProviderData(squad.map((player) => normalizeSquadPlayer(player, team)), "squad", 6 * 60 * 60 * 1000);
}

async function getPlayers(query) {
  const league = resolveLeague(query && query.league);
  const payload = await providerFetch("/players", compactParams({
    id: query && (query.playerId || query.id),
    team: query && query.teamId,
    league,
    season: resolveSeason(query && query.season),
    search: query && query.search,
    page: query && query.page
  }));
  return stampProviderData(responseItems(payload).map(item => normalizePlayer(item, resolveSeason(query && query.season))), "players", 24 * 60 * 60 * 1000);
}

/**
 * SAYFALI OYUNCU ÇEKİMİ — EKSİK KADRO SESSİZCE KABUL EDİLMEZ.
 *
 * API-Football `/players` uç noktası sayfa başına 20 kayıt döner ve toplam
 * sayfa sayısını yalnızca yanıtın `paging: { current, total }` alanında
 * bildirir. `getPlayers()` bu alanı atıyor: 34 kişilik bir kadro için ilk
 * 20 oyuncuyu döndürüp geri kalanını sessizce düşürüyordu. Derin
 * zenginleştirme (boy, doğum tarihi, forma numarası, uyruk) tam kadro
 * gerektirdiği için bu kabul edilemez — yarısı doldurulmuş bir kadro,
 * eksik olduğu belli olmayan bir kadrodur.
 *
 * Bu yüzden dönüş değeri ham liste değil, kapsama bilgisiyle birlikte
 * gelir. Çağıran taraf `complete` yanlışsa YAZMAMALIDIR; kısmi veriyi
 * tam veri gibi kaydetmek, hatayı veriye gömmek olur.
 *
 * @param {object} query   { teamId, league, season, search }
 * @param {object} options { requestBudget, maxPages }
 * @returns {Promise<{players: Array, pages: number, totalPages: number, complete: boolean, stoppedBy: string|null}>}
 */
async function getPlayersPaginated(query, options = {}) {
  const maxPages = Math.max(1, Number(options.maxPages) || 10);
  const budgetValue = Number(options.requestBudget);
  const requestBudget = Number.isFinite(budgetValue) ? Math.max(0, budgetValue) : Infinity;

  const league = resolveLeague(query && query.league);
  const season = resolveSeason(query && query.season);
  const baseParams = compactParams({
    team: query && (query.teamId || query.team),
    league,
    season,
    search: query && query.search
  });

  const collected = [];
  const seen = new Set();
  let pages = 0;
  let totalPages = 1;
  let stoppedBy = null;

  for (let page = 1; page <= totalPages; page += 1) {
    if (pages >= maxPages) {
      stoppedBy = "max-pages";
      break;
    }
    if (pages >= requestBudget) {
      stoppedBy = "request-budget";
      break;
    }

    // Sayfalar peş peşe istendiğinde dakikalık pencere zorlanır ve 429
    // yeniden denenmeyen bir hatadır (kotayı yakmamak için bilerek öyle).
    // İlk sayfadan sonraki her istekten önce kısa bir nefes, tüm adımı
    // düşürecek o hatayı ucuza önler.
    if (pages > 0) await delay(PAGINATION_DELAY_MS);

    const payload = await providerFetch("/players", { ...baseParams, page });
    pages += 1;

    const reported = Number(payload && payload.paging && payload.paging.total);
    if (Number.isFinite(reported) && reported > 0) totalPages = reported;

    for (const item of responseItems(payload)) {
      const normalized = normalizePlayer(item, season);
      const key = String(normalized.providerId || normalized.name || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      collected.push(normalized);
    }
  }

  return {
    players: stampProviderData(collected, "players", 24 * 60 * 60 * 1000),
    pages,
    totalPages,
    complete: pages >= totalPages && !stoppedBy,
    stoppedBy
  };
}

async function getPlayerById(query) {
  const data = await getPlayers({ ...query, playerId: query && query.playerId });
  return data[0] || null;
}

async function getPlayerTransfers(query) {
  const playerId = query && query.playerId;
  const teamId = query && query.teamId;
  if (!playerId && !teamId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Transfer icin playerId veya teamId query gerekli.");
  }

  const payload = await providerFetch("/transfers", compactParams({ player: playerId, team: teamId }));
  return stampProviderData(responseItems(payload).flatMap(normalizeTransfer), "transfers", 6 * 60 * 60 * 1000);
}

async function getTopScorers(query) {
  const league = ensureLeagueForData(query);
  const payload = await providerFetch("/players/topscorers", { league, season: resolveSeason(query && query.season) });
  return stampProviderData(responseItems(payload).map(normalizeLeagueLeaderEntry), "players", 6 * 60 * 60 * 1000, payload);
}

async function getTopAssists(query) {
  const league = ensureLeagueForData(query);
  const payload = await providerFetch("/players/topassists", { league, season: resolveSeason(query && query.season) });
  return stampProviderData(responseItems(payload).map(normalizeLeagueLeaderEntry), "players", 6 * 60 * 60 * 1000, payload);
}

async function getInjuries(query) {
  const league = resolveLeague(query && query.league);
  const payload = await providerFetch("/injuries", compactParams({
    league,
    season: resolveSeason(query && query.season),
    team: query && query.teamId
  }));
  return responseItems(payload);
}

async function getLineups(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Lineup icin fixtureId query gerekli.");
  }

  const payload = await providerFetch("/fixtures/lineups", { fixture: fixtureId });
  return responseItems(payload);
}

async function getFixtureEvents(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Mac olaylari icin fixtureId query gerekli.");
  }

  const payload = await providerFetch("/fixtures/events", { fixture: fixtureId });
  return responseItems(payload);
}

async function getFixtureStatistics(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Mac istatistigi icin fixtureId query gerekli.");
  }

  const payload = await providerFetch("/fixtures/statistics", { fixture: fixtureId });
  return responseItems(payload);
}

/**
 * MAÇ BAZINDA OYUNCU İSTATİSTİĞİ (/fixtures/players).
 *
 * Maç sonu zenginleştirmesinin eksik ayağıydı: olaylar, dizilişler ve takım
 * istatistikleri için uç nokta vardı, oyuncu istatistiği için yoktu. Bu uç
 * nokta oyuncu başına dakika, gol, asist, şut, pas, ikili mücadele ve
 * SAĞLAYICININ ÖLÇTÜĞÜ maç derecesini döndürüyor.
 *
 * Ham yanıt takım -> oyuncu listesi biçiminde; normalleştirme
 * postMatchEnrichmentService tarafında yapılıyor çünkü yayın kapısı orada.
 */
async function getFixturePlayers(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Mac oyuncu istatistigi icin fixtureId query gerekli.");
  }

  const payload = await providerFetch("/fixtures/players", { fixture: fixtureId });
  return responseItems(payload);
}

/**
 * Bir tarihteki fikstürleri döndürür — kimlik ÇÖZÜMLEMESİ için.
 *
 * Kürasyonlu maçların çoğunda sağlayıcı kimliği yok (9 tamamlanmış maçın
 * 7'sinde). Zenginleştirme yapabilmek için önce o kimliği bulmak gerekiyor:
 * tarih + iki takım adı ile eşleştirme. Ham fikstür nesnesi döndürülüyor
 * çünkü eşleştirici takım adlarının yanı sıra skoru da doğrulama için
 * kullanıyor.
 */
async function getFixturesByDate(query) {
  const date = query && query.date;
  if (!date) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Fikstür çözümlemesi için date query gerekli.");
  }

  const payload = await providerFetch("/fixtures", compactParams({
    date,
    timezone: "Europe/Istanbul",
    league: query.league || undefined,
    season: query.season || undefined
  }));
  return responseItems(payload);
}

function normalizeFixtureLineups(items) {
  // `players`/`substitutes` isim listesi olarak KALIR (mevcut tüketiciler
  // kırılmasın); saha dizilimi çizecek tüketiciler için forma numarası ve
  // sağlayıcının grid koordinatı ("satır:sütun") ayrı bir alanda taşınır.
  const toDetail = (entry) => {
    const player = (entry && entry.player) || {};
    if (!player.name) return null;
    return {
      name: player.name,
      number: player.number ?? null,
      position: player.pos || null,
      grid: player.grid || null
    };
  };

  return (Array.isArray(items) ? items : []).map((item) => ({
    team: teamName(item.team),
    formation: item.formation || null,
    players: (Array.isArray(item.startXI) ? item.startXI : [])
      .map((entry) => entry && entry.player && entry.player.name)
      .filter(Boolean),
    substitutes: (Array.isArray(item.substitutes) ? item.substitutes : [])
      .map((entry) => entry && entry.player && entry.player.name)
      .filter(Boolean),
    startingDetails: (Array.isArray(item.startXI) ? item.startXI : []).map(toDetail).filter(Boolean),
    substituteDetails: (Array.isArray(item.substitutes) ? item.substitutes : []).map(toDetail).filter(Boolean)
  }));
}

function normalizeFixtureEvents(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const elapsed = item.time && item.time.elapsed;
    const extra = item.time && item.time.extra;
    const minute = elapsed == null ? "" : `${elapsed}${extra ? `+${extra}` : ""}'`;
    const player = item.player && item.player.name;
    const assist = item.assist && item.assist.name;
    const details = [player, assist ? `Asist: ${assist}` : "", item.detail].filter(Boolean);
    const explicitEventTime = item.timestamp || item.date || item.createdAt || item.updatedAt;
    const parsedEventTime = explicitEventTime ? Date.parse(explicitEventTime) : NaN;

    return {
      time: minute,
      team: { name: teamName(item.team) },
      type: item.type || "Mac olayi",
      detail: item.detail || "",
      value: details.join(" · "),
      comments: item.comments || "",
      providerEventAt: Number.isFinite(parsedEventTime) ? new Date(parsedEventTime).toISOString() : null
    };
  });
}

/**
 * Oyuncu istatistiklerini düzleştirir.
 *
 * YALNIZCA sağlayıcının ölçtüğü alanlar taşınır. `rating` API-Football'ın
 * kendi ölçümüdür ve öyle etiketlenir — FutbolRadar bir derece UYDURMAZ,
 * yalnızca sağlayıcının verdiğini kaynağıyla birlikte aktarır. Sağlayıcı
 * bir alanı vermediyse alan hiç yazılmaz; sıfır ya da tahmin konmaz.
 */
function normalizeFixturePlayers(items) {
  const rows = [];

  for (const entry of Array.isArray(items) ? items : []) {
    const team = teamName(entry && entry.team);

    for (const record of (entry && Array.isArray(entry.players) ? entry.players : [])) {
      const player = record && record.player;
      const stats = (record && Array.isArray(record.statistics) ? record.statistics[0] : null) || {};
      const games = stats.games || {};

      const row = {
        name: (player && player.name) || "",
        team,
        providerPlayerId: player && player.id ? String(player.id) : null,
        source: "api-football"
      };

      // Number(null) === 0 olduğu için ham Number.isFinite yetmez: sağlayıcının
      // "ölçmedim" dediği alan (null) sıfır olarak yazılır ve UYDURMA veri
      // olurdu. Boş değer alanı hiç oluşturmaz.
      const measured = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const assign = (key, value) => {
        const parsed = measured(value);
        if (parsed !== null) row[key] = parsed;
      };

      assign("minutes", games.minutes);
      if (games.position) row.position = games.position;
      // Derece SAĞLAYICININ ölçümüdür ve kaynağıyla birlikte taşınır;
      // FutbolRadar oyuncu derecesi üretmez.
      const rating = measured(games.rating);
      if (rating !== null) {
        row.providerRating = rating;
        row.ratingSource = "api-football";
      }
      assign("goals", stats.goals && stats.goals.total);
      assign("assists", stats.goals && stats.goals.assists);
      assign("saves", stats.goals && stats.goals.saves);
      assign("shots", stats.shots && stats.shots.total);
      assign("shotsOnTarget", stats.shots && stats.shots.on);
      assign("passes", stats.passes && stats.passes.total);
      assign("passAccuracy", stats.passes && stats.passes.accuracy);
      // Kilit pas sağlayıcıda `passes.key` olarak geliyor; istenen oyuncu
      // kartında bu alan vardı ve ölçülmüş bir değer olduğu için taşınıyor.
      assign("keyPasses", stats.passes && stats.passes.key);
      assign("tackles", stats.tackles && stats.tackles.total);
      assign("duelsWon", stats.duels && stats.duels.won);
      assign("yellowCards", stats.cards && stats.cards.yellow);
      assign("redCards", stats.cards && stats.cards.red);

      if (row.name) rows.push(row);
    }
  }

  return rows;
}

function normalizeFixtureStatistics(items, match) {
  const teams = Array.isArray(items) ? items : [];
  const home = teams.find((item) => normalizeText(teamName(item.team)) === normalizeText(match.homeTeam)) || teams[0];
  const away = teams.find((item) => normalizeText(teamName(item.team)) === normalizeText(match.awayTeam)) || teams[1];
  const homeStats = new Map((home && Array.isArray(home.statistics) ? home.statistics : []).map((item) => [item.type, item.value]));
  const awayStats = new Map((away && Array.isArray(away.statistics) ? away.statistics : []).map((item) => [item.type, item.value]));
  const types = Array.from(new Set([...homeStats.keys(), ...awayStats.keys()]));

  const rawRows = types.map((type) => ({
    type,
    home: homeStats.has(type) ? homeStats.get(type) : null,
    away: awayStats.has(type) ? awayStats.get(type) : null
  }));

  // Sağlayıcı İngilizce tür adı ve metin değer döndürüyor ("Ball Possession"
  // → "58%"). Analiz katmanı kanonik Türkçe adı ve sayıyı okuyor; çeviri
  // olmadan çekilen istatistiklerin tamamı kayda girip okunamaz kalıyordu.
  const { statistics, unmapped } = canonicalizeStatistics(rawRows);
  if (unmapped.length) {
    console.warn(
      `[futbolradar:stat-unmapped] fixture=${match && match.id ? match.id : "?"} ` +
      `types=${JSON.stringify(unmapped)}`
    );
  }
  return statistics;
}

function statNumber(statistics, aliases, side) {
  const wanted = aliases.map((alias) => normalizeText(alias));
  const row = (Array.isArray(statistics) ? statistics : []).find((item) =>
    wanted.includes(normalizeText(item.type))
  );
  const value = row && row[side];
  const number = parseFloat(String(value == null ? "" : value).replace("%", "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function buildLiveMatchAnalysis(match, statistics, events) {
  const signals = [];
  const addSignal = (label, value, text) => signals.push({ label, value, text });
  const eventList = Array.isArray(events) ? events : [];
  // Satırlar normalizeFixtureStatistics'ten KANONİK adla geliyor; ham
  // İngilizce adlar da listede kalıyor ki kürasyonlu/eski kayıtlar da okunsun.
  const POSSESSION = ["Topla oynama", "Ball Possession", "Possession"];
  const TOTAL_SHOTS = ["Toplam şut", "Total Shots"];
  const ON_TARGET = ["İsabetli şut", "Shots on Goal", "Shots on Target"];
  const XG = ["Gol beklentisi (xG)", "expected_goals", "Expected Goals"];

  const possessionHome = statNumber(statistics, POSSESSION, "home");
  const possessionAway = statNumber(statistics, POSSESSION, "away");
  const shotsHome = statNumber(statistics, TOTAL_SHOTS, "home");
  const shotsAway = statNumber(statistics, TOTAL_SHOTS, "away");
  const targetHome = statNumber(statistics, ON_TARGET, "home");
  const targetAway = statNumber(statistics, ON_TARGET, "away");
  const xgHome = statNumber(statistics, XG, "home");
  const xgAway = statNumber(statistics, XG, "away");

  if (possessionHome !== null && possessionAway !== null) {
    const leader = possessionHome >= possessionAway ? match.homeTeam : match.awayTeam;
    addSignal("Top hakimiyeti", `${possessionHome}%-${possessionAway}%`, `${leader} topa sahip olma oranında önde.`);
  }

  if (shotsHome !== null && shotsAway !== null) {
    const leader = shotsHome >= shotsAway ? match.homeTeam : match.awayTeam;
    addSignal("Şut hacmi", `${shotsHome}-${shotsAway}`, `${leader} daha fazla şut üretti.`);
  }

  if (targetHome !== null && targetAway !== null) {
    const leader = targetHome >= targetAway ? match.homeTeam : match.awayTeam;
    addSignal("Kaleyi bulan", `${targetHome}-${targetAway}`, `${leader} isabetli şutlarda önde.`);
  }

  if (xgHome !== null && xgAway !== null) {
    const leader = xgHome >= xgAway ? match.homeTeam : match.awayTeam;
    addSignal("Gol beklentisi", `${xgHome.toFixed(2)}-${xgAway.toFixed(2)}`, `${leader} daha yüksek pozisyon kalitesi üretti.`);
  }

  const statisticSignalCount = signals.length;
  const goals = eventList.filter((event) => normalizeText(event.type) === "goal");
  const redCards = eventList.filter((event) => normalizeText(event.detail).includes("red card"));
  const substitutions = eventList.filter((event) => normalizeText(event.type).includes("subst"));

  if (redCards.length) {
    const redCardTeams = Array.from(new Set(redCards.map((event) => teamName(event.team)).filter(Boolean)));
    const label = redCardTeams.length === 1 ? redCardTeams[0] : "İki takım";
    addSignal(
      "Disiplin dengesi",
      `${redCards.length} kırmızı kart`,
      `${label} kırmızı kart gördü; oyuncu sayısı dengesi maçın akışını doğrudan etkiliyor.`
    );
  }

  if (goals.length) {
    const latestGoal = goals[goals.length - 1];
    const scorer = String(latestGoal.value || "").split(" · ")[0];
    addSignal(
      "Gol akışı",
      latestGoal.time || `${goals.length} gol`,
      `Son gol ${latestGoal.time || "maç içinde"}${scorer ? ` ${scorer} tarafından` : ""} kaydedildi.`
    );
  }

  if (substitutions.length >= 2) {
    addSignal(
      "Teknik hamleler",
      `${substitutions.length} değişiklik`,
      `Kulübeler oyuna müdahale etti; ${substitutions.length} oyuncu değişikliği kayda geçti.`
    );
  }

  const scoreHome = numberOrNull(match.score && match.score.home);
  const scoreAway = numberOrNull(match.score && match.score.away);
  const scoreLeader = scoreHome !== null && scoreAway !== null && scoreHome !== scoreAway
    ? (scoreHome > scoreAway ? match.homeTeam : match.awayTeam)
    : null;
  if (scoreHome !== null && scoreAway !== null) {
    addSignal(
      "Canlı skor",
      `${scoreHome}-${scoreAway}`,
      scoreLeader ? `${scoreLeader} skor üstünlüğünü elinde tutuyor.` : "Skor dengede."
    );
  }

  const eventSignalCount = signals.length - statisticSignalCount;
  const dataPoints = signals.length;
  const summary = signals.length
    ? `${signals[0].text}${signals[1] ? ` ${signals[1].text}` : ""}${scoreLeader ? ` Skor üstünlüğü ${scoreLeader} tarafında.` : ""}`
    : (scoreLeader
      ? `${scoreLeader} skorda önde; ayrıntılı canlı istatistikler geldikçe analiz genişleyecek.`
      : "Maç dengede; ayrıntılı canlı istatistikler geldikçe analiz genişleyecek.");

  return {
    title: match.live ? "Canlı Radar Analizi" : "Maç Radar Analizi",
    summary,
    confidence: statisticSignalCount >= 3
      ? "Yüksek"
      : statisticSignalCount >= 1 || eventSignalCount >= 2
        ? "Orta"
        : "Sınırlı",
    signals,
    eventCount: eventList.length,
    dataPoints,
    generatedAt: new Date().toISOString(),
    disclaimer: "Analiz yalnızca mevcut skor, olay ve canlı istatistiklerden üretilir; eksik veri tahminle doldurulmaz."
  };
}

async function getPredictions(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Tahmin icin fixtureId query gerekli.");
  }

  // API-Football supports /predictions on eligible plans. Keep the adapter
  // isolated so provider/plan changes never leak into frontend code.
  const payload = await providerFetch("/predictions", { fixture: fixtureId });
  return responseItems(payload);
}

/**
 * MAÇ ÖNCESİ ORANLAR — tahmin zincirinin İKİNCİ halkası.
 *
 * `/predictions` her fikstür için yanıt vermiyor (plan kapsamı, alt ligler,
 * kupa maçları). Oran verisi olan maçta 1X2 pazarı, sağlayıcı modelinin
 * yokluğunda en güçlü ikinci sinyaldir: piyasa, gerçek parayla oluşmuş bir
 * olasılık okumasıdır.
 *
 * Ham kayıt döner — hangi pazarın okunacağına, marjın nasıl çıkarılacağına
 * ve bahisçiler arası konsensüse karar vermek `services/fixtureProbabilityService.js`
 * işidir; bu katman yalnızca taşır.
 */
async function getOdds(query) {
  const fixtureId = query && query.fixtureId;
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Oran icin fixtureId query gerekli.");
  }

  const payload = await providerFetch("/odds", compactParams({
    fixture: fixtureId,
    // Pazar daraltması İSTEĞE BAĞLI: verilmezse bütün pazarlar gelir ve
    // 1X2 seçimi normalleştirme katmanında yapılır. `bet=1` (Match Winner)
    // verildiğinde yanıt küçülür ama bazı paketlerde bet filtresi boş
    // dönüyor; bu yüzden varsayılan olarak GÖNDERİLMEZ.
    bet: query && query.bet,
    bookmaker: query && query.bookmaker,
    page: query && query.page
  }));
  return responseItems(payload);
}

/**
 * SEZONLUK TAKIM İSTATİSTİĞİ — FutbolRadar modelinin son çare girdisi.
 *
 * Model normalde yerel doğrulanmış maç geçmişinden beslenir (takvim +
 * arşiv + lig tablosu) ve SAĞLAYICIYA HİÇ İSTEK ATMAZ. Bu uç nokta
 * yalnızca o kaynakların tamamı boş olduğunda (yeni yükselen takım,
 * sezonun ilk haftası, kupa maçında lig tablosunda olmayan takım)
 * çağrılır; aksi hâlde maç başına iki ek istek kotayı gereksiz yakar.
 */
async function getTeamStatistics(query) {
  const teamId = query && (query.teamId || query.team);
  if (!teamId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Takim istatistigi icin teamId query gerekli.");
  }
  const league = resolveLeague(query && query.league);
  if (!league) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Takim istatistigi icin league query gerekli.");
  }

  const payload = await providerFetch("/teams/statistics", compactParams({
    team: teamId,
    league,
    season: resolveSeason(query && query.season),
    date: query && query.date
  }));
  const items = responseItems(payload);
  // `/teams/statistics` tek nesne döndürür; responseItems onu diziye sarar.
  return Array.isArray(items) ? items[0] || null : items || null;
}

async function getMatchDetail(query) {
  const fixtureId = query && (query.fixtureId || query.id);
  if (!fixtureId) {
    throw new ProviderError("PROVIDER_QUERY_MISSING", "Mac detayi icin fixtureId veya id query gerekli.");
  }

  const requestedDate = query && query.date;
  const fixtures = requestedDate
    ? await getFixtures({ date: requestedDate })
    : await getFixtures({ fixtureId });
  const match = fixtures.find((item) => String(item.id) === String(fixtureId)) || null;
  if (!match) {
    throw new ProviderError("PROVIDER_NOT_FOUND", "Mac detayi provider tarafinda bulunamadi.");
  }

  // OYUNCU İSTATİSTİĞİ ARTIK CANLI MAÇTA DA ÇEKİLİYOR.
  //
  // Önceden yalnızca bitmiş maçta çekiliyordu; gerekçe her yoklamanın bir
  // istek harcamasıydı. O gerekçe artık geçerli değil: uç noktanın kendi
  // önbellek kovası var ("match-players", 3 dakika) ve tek uçuş sayesinde
  // aynı maçı izleyen kaç okuyucu olursa olsun sağlayıcıya giden istek
  // dakikada birin altında kalıyor. Başlamamış maçta hâlâ çekilmez —
  // oynanmamış maçın oyuncu istatistiği yoktur.
  const statusCode = String((match.providerStatus || match.status || "")).toUpperCase();
  const finished = ["FT", "AET", "PEN", "FINISHED"].includes(statusCode);
  const live = ["LIVE", "HALFTIME", "HT", "1H", "2H", "ET", "BT", "P", "IN_PLAY", "PAUSED"].includes(statusCode);
  const wantPlayers = finished || live;

  // TAHMİN İSTEĞİ ARTIK İSTEĞE BAĞLI.
  //
  // `/predictions` her maç detayı isteğinde çağrılıyordu ve maç detay
  // sayfası bu uç noktayı her görüntülemede tetikliyordu: günlük 100
  // isteklik kota tek bir popüler maçta eriyebiliyordu. Tahmin artık
  // zamanlanmış koşuda toplanıp `data/fixture-predictions.json` deposunda
  // duruyor (bkz. scripts/sync-fixture-predictions.mjs), sayfa da oradan
  // okuyor. Varsayılan DEĞİŞMEDİ — yalnızca istemci yolundaki çağrı
  // `includePredictions: false` ile kapatılıyor.
  const wantsPredictions = !query || query.includePredictions !== false;

  const [rawLineups, rawEvents, rawStatistics, predictions, rawPlayers] = await Promise.all([
    getLineups({ fixtureId }).catch(() => []),
    getFixtureEvents({ fixtureId }).catch(() => []),
    getFixtureStatistics({ fixtureId }).catch(() => []),
    wantsPredictions ? getPredictions({ fixtureId }).catch(() => []) : Promise.resolve([]),
    wantPlayers ? getFixturePlayers({ fixtureId }).catch(() => []) : Promise.resolve([])
  ]);
  const lineups = normalizeFixtureLineups(rawLineups);
  const events = normalizeFixtureEvents(rawEvents);
  const statistics = normalizeFixtureStatistics(rawStatistics, match);
  const players = normalizeFixturePlayers(rawPlayers);
  const analysis = buildLiveMatchAnalysis(match, statistics, events);

  return {
    ...match,
    fixtureId: String(fixtureId),
    lineups,
    events,
    statistics,
    players,
    prediction: predictions[0] || null,
    analysis,
    source: "api-football",
    providerUpdatedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    staleAfter: new Date(Date.now() + 2 * 60 * 1000).toISOString()
  };
}

function canSearchLocally(player, search) {
  if (!search) {
    return true;
  }

  return normalizeText(player.name).includes(normalizeText(search));
}


/**
 * Kimlik bilgisini gerçek istekle doğrular.
 *
 * Anahtar uzunluğuna bakarak "geçerli görünüyor" demek yeterli değil:
 * biçimi doğru ama süresi dolmuş, planı yetersiz veya başka bir hesaba ait
 * bir anahtar da aynı şekilde görünür. Bu yüzden API-Football'ın /status uç
 * noktasına gerçekten istek atılır; o uç nokta anahtarın geçerliliğini,
 * abonelik planını ve kota durumunu birlikte döner.
 *
 * Yanıta ASLA anahtarın kendisi girmez: yalnızca GERİ ÇEVRİLEMEZ bir özet ve
 * uzunluk raporlanır. Hesap adı/e-postası da PII olduğu için ayıklanır.
 */

/**
 * Anahtarı tanımlanabilir kılar ama HİÇBİR karakterini açığa çıkarmaz.
 *
 * Önceki hâli anahtarın ilk ve son 4 karakterini basıyordu. GitHub Actions
 * yalnızca sırrın TAM değerini `***` ile maskeliyor; kırpılmış parça
 * maskelemeye takılmadan koşu kaydına düşüyordu. 32 karakterlik bir
 * anahtarın 8 karakteri kırılabilir bir sızıntı değil, ama istenen buydu:
 * değerinden hiçbir parça yazılmasın.
 *
 * SHA-256 öneki aynı işi görüyor: iki farklı anahtar ayırt edilebiliyor,
 * aynı anahtarın koşular arasında değişmediği doğrulanabiliyor, geriye
 * çevrilemiyor.
 */
function maskKey(value) {
  const text = String(value || "");
  if (!text) return "(boş)";
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 8);
  return `sha256:${digest}… (len=${text.length})`;
}

/** Hangi environment değişkeni hangi değeri sağlıyor (değer maskeli). */
function credentialSources() {
  const seen = new Map();
  for (const name of APIFOOTBALL_API_KEY_ENV_NAMES) {
    const raw = process.env[name];
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (!value) continue;
    if (!seen.has(value)) seen.set(value, []);
    seen.get(value).push(name);
  }
  return [...seen.entries()].map(([value, envNames]) => ({ value, envNames }));
}

async function probeCredentials() {
  const config = getConfig();
  const baseUrl = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL("status", baseUrl);
  const sources = credentialSources();

  if (!sources.length) {
    return {
      endpoint: url.toString(),
      headerName: "x-apisports-key",
      candidates: [],
      note: "Tanımlı hiçbir APIFOOTBALL_* değişkeninde değer yok."
    };
  }

  // Sağlayıcının gerçek deneme sırası: biçimi geçerli olanlar önce.
  const ordered = [
    ...sources.filter((row) => looksLikeApiKey(row.value)),
    ...sources.filter((row) => !looksLikeApiKey(row.value))
  ];

  const candidates = [];
  for (const row of ordered) {
    const entry = {
      envNames: row.envNames,
      maskedKey: maskKey(row.value),
      formatValid: looksLikeApiKey(row.value),
      headersSent: { accept: "application/json", "x-apisports-key": maskKey(row.value) }
    };

    try {
      const response = await withTimeout(fetch(url, {
        headers: { accept: "application/json", "x-apisports-key": row.value }
      }), DEFAULT_TIMEOUT_MS);

      entry.httpStatus = response.status;
      // API-Sports kota/plan bilgisini yanıt başlıklarında da döner.
      entry.rateLimitHeaders = {
        "x-ratelimit-requests-limit": response.headers.get("x-ratelimit-requests-limit"),
        "x-ratelimit-requests-remaining": response.headers.get("x-ratelimit-requests-remaining")
      };

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      // errors alanı API-Sports'ta hem dizi hem nesne olabiliyor.
      const errors = payload && payload.errors;
      entry.apiErrors = errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)
        ? errors
        : null;

      const account = payload && payload.response;
      if (account && typeof account === "object") {
        // Hesap adı/e-postası raporlanmaz; plan ve kota yeterli.
        entry.subscription = account.subscription || null;
        entry.requests = account.requests || null;
      }

      entry.verdict = entry.apiErrors
        ? "REJECTED"
        : response.ok && entry.subscription
          ? "ACCEPTED"
          : response.ok
            ? "ACCEPTED_NO_DETAIL"
            : "HTTP_ERROR";
    } catch (error) {
      entry.httpStatus = null;
      entry.transportError = String((error && error.message) || error).slice(0, 200);
      entry.verdict = "TRANSPORT_ERROR";
    }

    candidates.push(entry);
  }

  return {
    endpoint: url.toString(),
    headerName: "x-apisports-key",
    candidates
  };
}

module.exports = {
  probeCredentials,
  credentialSources,
  name: "api-football",
  source,
  ProviderError,
  canSearchLocally,
  getConfig,
  hasConfig,
  providerFetch,
  cacheResourceFor,
  apiKeyCandidates,
  looksLikeApiKey,
  classifyPayloadError,
  seasonForDate,
  getFixtures,
  getMatches,
  getSeasonFixtures,
  getStandings,
  getLeagues,
  getTeams,
  searchTeams,
  getSquad,
  getSquadEntry,
  getPlayers,
  getPlayersPaginated,
  getPlayerById,
  getPlayerMatchLog,
  getPlayerTransfers,
  getTopScorers,
  getTopAssists,
  normalizeLeagueLeaderEntry,
  getInjuries,
  getLineups,
  getFixtureEvents,
  getFixtureStatistics,
  getFixturePlayers,
  normalizeFixturePlayers,
  providerRequestStats,
  resetProviderRequestStats,
  getProviderRateLimit,
  getFixturesByDate,
  getPredictions,
  getOdds,
  getTeamStatistics,
  getMatchDetail,
  normalizeFixture,
  normalizeFixtureLineups,
  normalizeFixtureEvents,
  normalizeFixtureStatistics,
  buildLiveMatchAnalysis,
  filterSupportedCompetitions,
  competitionMatchesFixture,
  normalizeStandingRow,
  normalizeTeam,
  normalizePlayer,
  aggregateStatistics,
  fixturePlayerStats,
  normalizeTransfer
};
