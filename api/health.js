const {
  API_KEY_ENV_NAMES,
  BASE_URL_ENV_NAMES,
  COMPETITION_CODE_ENV_NAMES,
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess
} = require("./_utils");
const { LIVE_PROVIDER_RESOURCES, hasLiveProviderConfig } = require("../services/providers");
const { getConfig } = require("../services/providers/footballProvider");

function presentEnvNames(names) {
  return names.filter((name) => Boolean(process.env[name]));
}

function buildDiagnostics(config) {
  const apiKeyEnvNamesPresent = presentEnvNames(API_KEY_ENV_NAMES);
  const baseUrlEnvNamesPresent = presentEnvNames(BASE_URL_ENV_NAMES);
  const competitionEnvNamesPresent = presentEnvNames(COMPETITION_CODE_ENV_NAMES);
  const liveProviderConfigured = hasLiveProviderConfig();
  const liveProviderResources = Array.from(LIVE_PROVIDER_RESOURCES);

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
    nodeEnv: process.env.NODE_ENV || ""
  };
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  getQuery(req);

  const config = getConfig();

  return sendSuccess(res, [buildDiagnostics(config)]);
};
