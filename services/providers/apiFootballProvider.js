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
const { competitions, matchesCompetition } = require("../competitionCatalog");
// Bağımlılığı olmayan bir okuyucu; leagueResolver'ı require etmek sağlayıcı
// ile resolver arasında döngü yaratırdı.
const { readCachedLeague } = require("../leagueCache");
const { canonicalizeStatistics } = require("../matchStatisticsSchema");
const { fetchWithCache } = require("../providerCache");
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

async function providerFetch(path, params) {
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

function isRetryable(error) {
  if (!error) return false;
  if (RETRYABLE_CODES.has(error.code)) {
    // 4xx bir istemci hatası; tekrar denemek aynı yanıtı getirir.
    return !error.statusCode || error.statusCode >= 500 || error.statusCode === 408;
  }
  // withTimeout ve fetch'in kendi hataları ProviderError olmayabilir.
  return error.name === "AbortError" || /timeout|network|socket|ECONN|fetch failed/i.test(String(error.message || ""));
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

  const request = fetch(url, {
    headers: {
      accept: "application/json",
      "x-apisports-key": apiKey
    }
  }).then(async (response) => {
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
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

function responseItems(payload) {
  return Array.isArray(payload && payload.response) ? payload.response : [];
}

function teamName(team) {
  return team && (team.name || team.shortName || team.code) || "";
}

function teamLogo(team) {
  return (team && team.logo) || "";
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

function stampProviderData(records, resource, staleAfterMs) {
  const fetchedAt = new Date().toISOString();
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

function normalizeStatus(status) {
  const short = status && status.short;
  // Devre arasi ayri bir durum: arayuz "Devre arasi" diyebilmeli. LIVE'a
  // ezilirse skor tablosunda oynanmayan bir maca dakika bekleniyormus gibi
  // gorunuyordu. Devre arasi hala "in-play" sayilir (live: true).
  if (short === "HT" || short === "BT") {
    return "HALFTIME";
  }
  if (["1H", "2H", "ET", "P", "LIVE"].includes(short)) {
    return "LIVE";
  }

  if (["FT", "AET", "PEN"].includes(short)) {
    return "FINISHED";
  }

  return "SCHEDULED";
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
  const teams = item.teams || {};
  const goals = item.goals || {};
  const kickoff = fixture.date || "";
  const homeTeam = teams.home || {};
  const awayTeam = teams.away || {};

  return {
    id: String(fixture.id || `${teamName(homeTeam)}-${teamName(awayTeam)}-${kickoff}`),
    providerId: fixture.id ? String(fixture.id) : "",
    league: league.name || "",
    round: roundNumber(league),
    venue: (fixture.venue && fixture.venue.name) || null,
    kickoff,
    time: kickoff ? new Date(kickoff).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "",
    homeTeam: teamName(homeTeam),
    awayTeam: teamName(awayTeam),
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
    source: "api-football"
  };
}

function filterSupportedCompetitions(matches) {
  return (Array.isArray(matches) ? matches : []).filter((match) =>
    competitions.some((competition) => matchesCompetition(match.league, competition))
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
    league: leagueName || "",
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
    photo: item.photo || null,
    dataStatus: "provider",
    ratingStatus: "pending",
    source: "api-football"
  };
}

function firstStatistic(item) {
  return Array.isArray(item.statistics) && item.statistics[0] ? item.statistics[0] : {};
}

function normalizePlayer(item) {
  const player = item.player || item;
  const statistics = firstStatistic(item);
  const team = statistics.team || item.team || {};
  const games = statistics.games || {};
  const goals = statistics.goals || {};
  const cards = statistics.cards || {};
  const rating = games.rating == null ? null : Number(games.rating);
  const minutes = numberOrNull(games.minutes);
  const appearances = numberOrNull(firstDefined(games.appearences, games.appearances));
  const playerGoals = numberOrNull(goals.total);
  const assists = numberOrNull(goals.assists);
  const yellowCards = numberOrNull(cards.yellow);
  const redCards = numberOrNull(cards.red);

  return {
    id: String(player.id || player.name || ""),
    providerId: player.id ? String(player.id) : "",
    providerName: "api-football",
    name: player.name || "",
    currentTeam: teamName(team),
    team: teamName(team),
    formerTeams: [],
    league: "",
    position: games.position || player.position || "",
    birthDate: player.birth && player.birth.date || null,
    computedAge: player.age || null,
    age: player.age || null,
    nationality: player.nationality || null,
    height: player.height || null,
    weight: player.weight || null,
    marketValueEur: null,
    photo: player.photo || null,
    stats: {
      appearances,
      minutes,
      goals: playerGoals,
      assists,
      yellowCards,
      redCards
    },
    appearances,
    minutesPlayed: minutes,
    minutes,
    goals: playerGoals,
    assists,
    yellowCards,
    redCards,
    rating,
    aiRating: rating,
    overallRating: rating,
    transferHistory: [],
    dataStatus: "provider",
    ratingStatus: rating == null ? "pending" : "provider",
    transferUpdatedAt: null,
    source: "api-football",
    lastSyncedAt: firstDefined(item.lastSyncedAt, item.fetchedAt)
  };
}

function normalizeTransfer(item) {
  const player = item.player || {};
  const transfers = Array.isArray(item.transfers) ? item.transfers : [];
  return transfers.map((transfer, index) => {
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
  });
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

  // KOTA KORUMASI (services/providerCache.js)
  //
  // Bu yol sitedeki en sık çağrılan sağlayıcı çağrısı: istemci 20 saniyede
  // bir canlı skor yokluyor ve CDN önbelleği 10 saniyede bir düşüyor. Her
  // ıska doğrudan API-Football'a gidiyordu; ücretsiz paketin günlük 100
  // isteklik kotası tek bir maç gününde tükenebilir.
  //
  // Önbellek üç şey sağlıyor: TTL içinde tekrar sormama, eşzamanlı
  // isteklerin tek çağrıya indirgenmesi ve 429/kesinti anında son BAŞARILI
  // yanıtın sınırlı süre servis edilmesi. Uydurma veri üretmiyor — yalnızca
  // gerçek bir yanıtın tekrar kullanılması.
  const cacheResource = liveValue ? "matches-live" : "matches";
  const { data: payload } = await fetchWithCache(
    cacheResource,
    { id: fixtureId, date, live: liveValue },
    () => providerFetch("/fixtures", {
      id: fixtureId,
      date,
      live: liveValue || undefined
    })
  );
  const matches = responseItems(payload).map(normalizeFixture);
  const supportedMatches = filterSupportedCompetitions(matches);
  const filteredMatches = league && competition
    ? supportedMatches.filter((match) => matchesCompetition(match.league, competition))
    : supportedMatches;
  return stampProviderData(filteredMatches, "matches", 5 * 60 * 1000);
}

async function getMatches(query) {
  return getFixtures(query);
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
  return stampProviderData(matches, "season-fixtures", 60 * 60 * 1000);
}

async function getStandings(query) {
  const league = ensureLeagueForData(query);
  const season = resolveSeason(query && query.season);
  const payload = await providerFetch("/standings", { league, season });
  const leaguePayload = responseItems(payload)[0] && responseItems(payload)[0].league || {};
  const table = Array.isArray(leaguePayload.standings) ? leaguePayload.standings[0] || [] : [];
  return stampProviderData(table.map((row) => normalizeStandingRow(row, leaguePayload.name)), "standings", 60 * 60 * 1000);
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
      return {
        id: league.id === undefined || league.id === null ? null : String(league.id),
        name: league.name || "",
        type: league.type || "",
        country: country.name || "",
        seasons: Array.isArray(item && item.seasons)
          ? item.seasons.map((season) => String(season && season.year)).filter(Boolean)
          : []
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
  return stampProviderData(responseItems(payload).map(normalizePlayer), "players", 24 * 60 * 60 * 1000);
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
  return stampProviderData(responseItems(payload).map(normalizePlayer), "players", 6 * 60 * 60 * 1000);
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
    league: query.league || undefined,
    season: query.season || undefined
  }));
  return responseItems(payload);
}

function normalizeFixtureLineups(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    team: teamName(item.team),
    formation: item.formation || null,
    players: (Array.isArray(item.startXI) ? item.startXI : [])
      .map((entry) => entry && entry.player && entry.player.name)
      .filter(Boolean),
    substitutes: (Array.isArray(item.substitutes) ? item.substitutes : [])
      .map((entry) => entry && entry.player && entry.player.name)
      .filter(Boolean)
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

    return {
      time: minute,
      team: { name: teamName(item.team) },
      type: item.type || "Mac olayi",
      detail: item.detail || "",
      value: details.join(" · "),
      comments: item.comments || ""
    };
  });
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

  const [rawLineups, rawEvents, rawStatistics, predictions] = await Promise.all([
    getLineups({ fixtureId }).catch(() => []),
    getFixtureEvents({ fixtureId }).catch(() => []),
    getFixtureStatistics({ fixtureId }).catch(() => []),
    getPredictions({ fixtureId }).catch(() => [])
  ]);
  const lineups = normalizeFixtureLineups(rawLineups);
  const events = normalizeFixtureEvents(rawEvents);
  const statistics = normalizeFixtureStatistics(rawStatistics, match);
  const analysis = buildLiveMatchAnalysis(match, statistics, events);

  return {
    ...match,
    fixtureId: String(fixtureId),
    lineups,
    events,
    statistics,
    prediction: predictions[0] || null,
    analysis,
    source: "api-football",
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
  getSquad,
  getPlayers,
  getPlayerById,
  getPlayerTransfers,
  getTopScorers,
  getInjuries,
  getLineups,
  getFixtureEvents,
  getFixtureStatistics,
  getFixturePlayers,
  getFixturesByDate,
  getPredictions,
  getMatchDetail,
  normalizeFixture,
  normalizeFixtureLineups,
  normalizeFixtureEvents,
  normalizeFixtureStatistics,
  buildLiveMatchAnalysis,
  filterSupportedCompetitions,
  normalizeStandingRow,
  normalizeTeam,
  normalizePlayer,
  normalizeTransfer
};
