const footballProvider = require("./footballProvider");
const mockProvider = require("./mockProvider");
const LIVE_PROVIDER_RESOURCES = new Set(["matches", "standings"]);

function hasLiveProviderConfig() {
  return Boolean(process.env.FOOTBALL_API_KEY);
}

function getProvider(resource) {
  if (hasLiveProviderConfig() && (!resource || LIVE_PROVIDER_RESOURCES.has(resource))) {
    return footballProvider;
  }

  return mockProvider;
}

module.exports = {
  getProvider,
  hasLiveProviderConfig,
  LIVE_PROVIDER_RESOURCES,
  mockProvider,
  footballProvider
};
