const {
  API_KEY_ENV_NAMES,
  BASE_URL_ENV_NAMES,
  COMPETITION_CODE_ENV_NAMES,
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess
} = require("./_utils");
const { LIVE_PROVIDER_RESOURCES, hasLiveProviderConfig } = require("./providers");
const { getConfig } = require("./providers/footballProvider");

function presentEnvNames(names) {
  return names.filter((name) => Boolean(process.env[name]));
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  getQuery(req);

  const config = getConfig();

  return sendSuccess(res, [
    {
      liveProviderConfigured: hasLiveProviderConfig(),
      provider: config.provider,
      baseUrlConfigured: Boolean(config.baseUrl),
      baseUrlEnvConfigured: Boolean(presentEnvNames(BASE_URL_ENV_NAMES).length),
      baseUrlEnvNamesPresent: presentEnvNames(BASE_URL_ENV_NAMES),
      apiKeyConfigured: hasLiveProviderConfig(),
      apiKeyEnvNamesPresent: presentEnvNames(API_KEY_ENV_NAMES),
      competitionCodeConfigured: Boolean(config.competitionCode),
      competitionCodeEnvConfigured: Boolean(presentEnvNames(COMPETITION_CODE_ENV_NAMES).length),
      competitionEnvNamesPresent: presentEnvNames(COMPETITION_CODE_ENV_NAMES),
      defaultCompetitionCode: "TSL",
      liveProviderResources: Array.from(LIVE_PROVIDER_RESOURCES),
      vercelEnv: process.env.VERCEL_ENV || "",
      nodeEnv: process.env.NODE_ENV || ""
    }
  ]);
};
