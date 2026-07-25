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

  getQuery(req);

  const config = getConfig();

  return sendSuccess(res, [buildDiagnostics(config)]);
};
