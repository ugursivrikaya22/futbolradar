const {
  API_KEY_ENV_NAMES,
  APIFOOTBALL_API_KEY_ENV_NAMES,
  BASE_URL_ENV_NAMES,
  COMPETITION_CODE_ENV_NAMES,
  enforceRateLimit,
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess,
  setCachePolicy
} = require("./_utils");
const { LIVE_PROVIDER_RESOURCES, hasLiveProviderConfig, getProvider, getProviderChain, apiFootballProvider } = require("../services/providers");
const { getConfig } = require("../services/providers/footballProvider");
const { readCachedLeague } = require("../services/leagueCache");
const { buildPipelineDiagnostics } = require("../services/pipelineDiagnostics");
const { curatedMatches } = require("../services/providers/mockProvider");
const homePollStore = require("../services/homePollVoteStore");

/**
 * HANGİ DAĞITIM YANIT VERİYOR? — "değişkeni ekledim ama görünmüyor"un
 * iki ayrı sebebini ayırmak için.
 *
 * Ortam değişkeni eklemek tek başına yetmez: Vercel değerleri isteğe değil
 * DAĞITIMA bağlar, yani yeni değişken ancak yeni bir dağıtımda görünür.
 * Buna karşılık değişken doğru ama BAŞKA bir projeye/ortama eklenmişse
 * kaç kez yeniden dağıtılırsa dağıtılsın hiçbir şey değişmez. Dışarıdan
 * ikisi de "değişken yok" diye görünüyordu ve aradaki farkı ölçecek hiçbir
 * alan yoktu; bu blok o farkı ölçüyor.
 *
 * Sır yazılmaz. Depo adı, dal adı ve KISA commit kimliği, yayındaki
 * sitenin içeriğiyle zaten eşleşen genel bilgilerdir; bunlarla bir şeye
 * erişilemez. Dağıtım adresi yazılmaz.
 */
function deploymentSection() {
  const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || "");
  return {
    platform: process.env.VERCEL ? "vercel" : "other",
    environment: process.env.VERCEL_ENV || "",
    region: process.env.VERCEL_REGION || "",
    repo: [process.env.VERCEL_GIT_REPO_OWNER, process.env.VERCEL_GIT_REPO_SLUG]
      .filter(Boolean)
      .join("/"),
    branch: process.env.VERCEL_GIT_COMMIT_REF || "",
    commit: sha ? sha.slice(0, 7) : "",
    // Sistem değişkenleri kapatılmışsa yukarıdaki alanlar boş kalır; bu
    // "eski dağıtım" ile karıştırılmasın diye ayrıca bildiriliyor.
    systemEnvExposed: Boolean(process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL)
  };
}

/**
 * ANKET OY DEPOSU — teşhis sağlık ucunda da olsun.
 *
 * Aynı bilgi `/api/home-poll` yanıtında da var, ama operatör kurulum
 * doğrularken sağlık ucuna bakıyor ve orada anketle ilgili tek satır
 * yoktu. Mantık kopyalanmadı: karar da, ipucu da deponun kendi
 * fonksiyonlarından okunuyor.
 */
function homePollStorageSection() {
  const present = (names) => names.filter((name) => String(process.env[name] || "").trim() !== "");
  const keyNames = present(homePollStore.SERVICE_KEY_ENV_NAMES);
  const configured = homePollStore.isConfigured();

  return {
    storage: configured ? "ready" : "unavailable",
    urlEnvNames: present(homePollStore.REST_URL_ENV_NAMES),
    serviceKeyEnvNames: keyNames,
    anonKeyEnvNames: present(homePollStore.ANON_KEY_ENV_NAMES),
    ipSaltEnvNames: present(homePollStore.IP_SALT_ENV_NAMES),
    // Anahtarın kendisi değil, JWT'nin ilan ettiği ROL. Yanlış anahtarı
    // yapıştırmak en sık yapılan hata ve RLS açıkken sessizce reddedilir.
    serviceKeyRole: keyNames.length ? (homePollStore.keyRole(String(process.env[keyNames[0]]).trim()) || "okunamadi") : "",
    // Ad da değer de yazılmaz, yalnızca SAYI: "hiç eklenmemiş" ile
    // "yanlış adla eklenmiş" ancak böyle ayrılıyor.
    supabaseNamedEnvCount: Object.keys(process.env).filter((name) => /supabase/i.test(name)).length,
    // Serbest metin yapılandırma ipucu YALNIZCA `diagnosticsAuthorized()`
    // doğrularsa eklenir — aksi hâlde bu genel/kimliksiz uç, hangi ortam
    // değişkeninin eksik olduğunu herkese açık şekilde anlatan bir metin
    // döndürmüş olurdu (bkz. handler'daki `authorized` kontrolü).
    configuration: ""
  };
}

/**
 * TEŞHİS AYRINTISI (serbest metin hata gövdesi, yapılandırma ipucu) YALNIZCA
 * bu iki koşuldan biri sağlanırsa döner: yerelde/CI'de çalışılıyor (Vercel
 * sistem değişkenleri yok) YA DA istek `HEALTH_DIAGNOSTICS_TOKEN` ile eşleşen
 * bir üstbilgi taşıyor. Üretimde token tanımlı değilse ayrıntı hiç dönmez —
 * güvenli varsayılan budur. Sır burada da yazılmaz: token'ın kendisi hiçbir
 * yanıta yansımaz, yalnızca eşleşip eşleşmediği kontrol edilir.
 */
function diagnosticsAuthorized(req) {
  if (!process.env.VERCEL) return true;
  const expected = String(process.env.HEALTH_DIAGNOSTICS_TOKEN || "").trim();
  if (!expected) return false;
  const provided = String((req.headers && req.headers["x-health-token"]) || "").trim();
  return provided === expected;
}

/**
 * Maç hattının durumu: son senkron, bugünün maçları, canlı sayısı, analiz
 * bekleyen tamamlanmış maçlar, tamamlanan/kısmi/başarısız analizler ve veri
 * tazeliği. Sağlayıcı yapılandırması tek başına "hat çalışıyor mu"
 * sorusunu yanıtlamıyordu.
 */
function readReportStore() {
  try {
    const store = require("../data/post-match-reports.json");
    return Array.isArray(store.records) ? store.records : [];
  } catch (error) {
    // Depo henüz üretilmemiş olabilir; bu bir hata değil.
    return [];
  }
}

function pipelineSection() {
  try {
    return buildPipelineDiagnostics({ matches: curatedMatches(), reports: readReportStore() });
  } catch (error) {
    return { error: "pipeline-diagnostics-unavailable", message: String(error.message || error).slice(0, 200) };
  }
}

function presentEnvNames(names) {
  return names.filter((name) => String(process.env[name] || "").trim() !== "");
}

/**
 * Kimlik bilgisinin kendisini değil, "doğru değişkene doğru biçimde
 * girilmiş mi" sorusunun cevabını raporlar: hangi isimler dolu, değer kaç
 * karakter ve kırpılması gerekiyor muydu. Yanlış isme yazılmış ya da sonda
 * boşluk taşıyan bir anahtar sağlayıcıda "Missing application key" olarak
 * görünüyor; bu alanlar olmadan ikisi ayırt edilemiyor. Değer hiçbir
 * koşulda yanıta girmez.
 */
function credentialShape(names) {
  return names
    .filter((name) => process.env[name] !== undefined && process.env[name] !== "")
    .map((name) => {
      const raw = String(process.env[name]);
      const trimmed = raw.trim();
      return {
        env: name,
        length: trimmed.length,
        // API-Sports anahtarı tam 32 onaltılık karakterdir; false ise değer
        // eksik/bozuk kopyalanmıştır ve sağlayıcıya sormaya bile gerek yok.
        looksValidFormat: apiFootballProvider.looksLikeApiKey(trimmed),
        hadSurroundingWhitespace: raw !== trimmed,
        looksQuoted: /^["'].*["']$/.test(trimmed),
        blank: trimmed === ""
      };
    });
}

function buildDiagnostics(config) {
  const apiKeyEnvNamesPresent = presentEnvNames(API_KEY_ENV_NAMES);
  const baseUrlEnvNamesPresent = presentEnvNames(BASE_URL_ENV_NAMES);
  const competitionEnvNamesPresent = presentEnvNames(COMPETITION_CODE_ENV_NAMES);
  const liveProviderConfigured = hasLiveProviderConfig();
  const liveProviderResources = Array.from(LIVE_PROVIDER_RESOURCES);
  const apiFootballConfig = apiFootballProvider.getConfig();
  const cachedLeague = readCachedLeague();

  return {
    mode: liveProviderConfigured ? "live-ready" : "mock",
    providerSource: liveProviderConfigured ? "FutbolRadar Live API" : "FutbolRadar Mock API",
    liveProviderConfigured,
    provider: config.provider,
    baseUrlConfigured: Boolean(config.baseUrl),
    baseUrlEnvConfigured: Boolean(baseUrlEnvNamesPresent.length),
    baseUrlEnvCount: baseUrlEnvNamesPresent.length,
    credentialConfigured: liveProviderConfigured,
    credentialEnvCount: apiKeyEnvNamesPresent.length,
    competitionCodeConfigured: Boolean(config.competitionCode),
    competitionCodeEnvConfigured: Boolean(competitionEnvNamesPresent.length),
    competitionEnvCount: competitionEnvNamesPresent.length,
    defaultCompetitionCode: "TSL",
    liveProviderResources,
    mockOnlyResources: ["teams", "players", "momentum", "signals", "analyses"],
    missingRequiredEnv: liveProviderConfigured ? [] : ["live credential"],
    nextAction: liveProviderConfigured
      ? "Live provider matches ve standings icin secilir; provider hata verirse frontend statik yedek veriye duser."
      : "Production ortaminda live credential gorunmuyor; matches ve standings Mock API kullanir.",
    vercelEnv: process.env.VERCEL_ENV || "",
    nodeEnv: process.env.NODE_ENV || "",
    apiFootball: {
      credentialPresent: Boolean(presentEnvNames(APIFOOTBALL_API_KEY_ENV_NAMES).length),
      baseUrlConfigured: Boolean(apiFootballConfig.baseUrl),
      configured: apiFootballProvider.hasConfig(),
      // Hangi değişken okunuyor ve değeri biçimsel olarak sağlam mı.
      credentialEnvNames: presentEnvNames(APIFOOTBALL_API_KEY_ENV_NAMES),
      credentialShape: credentialShape(APIFOOTBALL_API_KEY_ENV_NAMES),
      // Kaç farklı anahtar değeri deneniyor: birden fazlaysa ortamda eski
      // ve yeni anahtar bir arada demektir.
      credentialCandidateCount: apiFootballConfig.apiKeyCandidateCount,
      activeBaseUrl: apiFootballConfig.baseUrl,
      leagueIdConfigured: Boolean(apiFootballConfig.leagueId),
      // Lig kimliği env'de olmayabilir ama çözülmüş ve depoya yazılmış
      // olabilir. Yalnızca env'e bakmak, senkron "çözüldü" derken sağlık
      // ucunun "yapılandırılmamış" demesine yol açıyordu.
      leagueIdSource: apiFootballConfig.leagueId
        ? "env"
        : (cachedLeague ? "cache" : "unresolved"),
      resolvedLeagueId: apiFootballConfig.leagueId || (cachedLeague ? cachedLeague.leagueId : null),
      resolvedSeason: apiFootballConfig.season
    },
    providerSelection: {
      primaryProviderEnv: process.env.FOOTBALL_PRIMARY_PROVIDER || null,
      matchProviderEnv: process.env.FOOTBALL_MATCH_PROVIDER || null,
      resolvedMatchProvider: getProvider("matches").name,
      resolvedStandingsProvider: getProvider("standings").name,
      // Full failover order, so an outage report shows not just who was
      // asked first but who is available to take over.
      matchProviderChain: getProviderChain("matches").map((provider) => provider.name),
      standingsProviderChain: getProviderChain("standings").map((provider) => provider.name),
      seasonFixtureProviderChain: getProviderChain("super-lig-fixtures").map((provider) => provider.name)
    }
  };
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  setCachePolicy(res, "health");
  if (enforceRateLimit(req, res, { limit: 30 })) return;

  const query = getQuery(req);
  const authorized = diagnosticsAuthorized(req);
  const config = getConfig();
  const diagnostics = buildDiagnostics(config);
  diagnostics.deployment = deploymentSection();
  diagnostics.homePollStorage = homePollStorageSection();
  if (authorized && diagnostics.homePollStorage.storage !== "ready") {
    diagnostics.homePollStorage.configuration = homePollStore.configurationHint();
  }
  diagnostics.pipeline = pipelineSection();

  // `?probe=api-football` kimliği gerçek istekle sınar. Biçim kontrolü
  // "anahtar geçerli mi" sorusunu cevaplamıyor: doğru biçimde ama süresi
  // dolmuş, planı yetersiz ya da başka hesaba ait bir anahtar da geçerli
  // görünür. Prob, sağlayıcının döndüğü HTTP kodunu ve hata gövdesini
  // olduğu gibi raporlar. Anahtarın kendisi hiçbir koşulda yanıta girmez.
  if (String(query.probe || "") === "api-football") {
    diagnostics.apiFootballProbe = await apiFootballProvider.probeCredentials();
  }

  // `?probe=supabase` GERÇEK bir istek gönderir (env değişkeni okumakla
  // yetinmez). "Değişkenler dolu" ile "depo gerçekten çalışıyor" farklı
  // sorular: anahtar yanlış PROJEYE ait olabilir, tablo hiç oluşturulmamış
  // olabilir, ya da servis anahtarı yerine anon anahtar girilmiş olabilir
  // (RLS bunu sessizce reddeder). Bu üçü de "storage: unavailable" olarak
  // aynı görünür; prob PostgREST'in kendi hata gövdesini (şema bilgisi,
  // SIR değil) döndürerek ayırt eder. Anket sayımını BOZMAZ: yalnızca
  // okur, `readTally` hiçbir satır yazmaz.
  if (String(query.probe || "") === "supabase") {
    if (!homePollStore.isConfigured()) {
      diagnostics.supabaseProbe = {
        attempted: false,
        note: authorized ? homePollStore.configurationHint() : ""
      };
    } else {
      try {
        const tally = await homePollStore.readTally("home-health-probe");
        diagnostics.supabaseProbe = {
          attempted: true,
          ok: true,
          table: homePollStore.TABLE,
          rowsForProbePollId: Object.values(tally).reduce((sum, n) => sum + (Number(n) || 0), 0)
        };
      } catch (error) {
        diagnostics.supabaseProbe = {
          attempted: true,
          ok: false,
          // Ham hata gövdesi yalnızca yetkili teşhis isteğinde yazılır —
          // aksi hâlde bu genel/kimliksiz uç, sağlayıcının şema/durum
          // metnini herkese açık şekilde döndürmüş olurdu.
          error: authorized ? String((error && error.message) || error).slice(0, 300) : ""
        };
      }
    }
  }

  return sendSuccess(res, [diagnostics]);
};
