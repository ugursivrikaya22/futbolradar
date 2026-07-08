const {
  getQuery,
  rejectUnsupportedMethod,
  sendSuccess
} = require("./_utils");
const { LIVE_PROVIDER_RESOURCES, hasLiveProviderConfig } = require("./providers");

const API_KEY_ENV_NAMES = [
  "FOOTBALL_API_KEY",
  "FOOTBALL_DATA_API_KEY",
  "FOOTBALL_DATA_TOKEN",
  "FOOTBALL_API_TOKEN"
];

const COMPETITION_ENV_NAMES = [
  "FOOTBALL_COMPETITION_CODE",
  "FOOTBALL_DATA_COMPETITION_CODE",
  "COMPETITION_CODE"
];

function presentEnvNames(names) {
  return names.filter((name) => Boolean(process.env[name]));
}

module.exports = async function handler(req, res) {
  if (rejectUnsupportedMethod(req, res)) {
    return;
  }

  getQuery(req);

  return sendSuccess(res, [
    {
      liveProviderConfigured: hasLiveProviderConfig(),
      provider: process.env.FOOTBALL_API_PROVIDER || "football-data",
      baseUrlConfigured: Boolean(process.env.FOOTBALL_API_BASE_URL),
      apiKeyConfigured: hasLiveProviderConfig(),
      apiKeyEnvNamesPresent: presentEnvNames(API_KEY_ENV_NAMES),
      competitionCodeConfigured: Boolean(presentEnvNames(COMPETITION_ENV_NAMES).length),
      competitionEnvNamesPresent: presentEnvNames(COMPETITION_ENV_NAMES),
      defaultCompetitionCode: "TSL",
      liveProviderResources: Array.from(LIVE_PROVIDER_RESOURCES),
      vercelEnv: process.env.VERCEL_ENV || "",
      nodeEnv: process.env.NODE_ENV || ""
    }
  ]);
};
