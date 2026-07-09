const footballProvider = require("./footballProvider");
const apiFootballProvider = require("./apiFootballProvider");
const mockProvider = require("./mockProvider");
const { hasProviderConfig } = require("../_utils");
const LIVE_PROVIDER_RESOURCES = new Set(["matches", "standings"]);

function hasLiveProviderConfig() {
  return hasProviderConfig();
}

function normalizeProviderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function providerCandidates(resource) {
  const primary = process.env.FOOTBALL_PRIMARY_PROVIDER;
  const matchProvider = process.env.FOOTBALL_MATCH_PROVIDER;
  const playerProvider = process.env.FOOTBALL_PLAYER_PROVIDER;
  const transferProvider = process.env.FOOTBALL_TRANSFER_PROVIDER;

  if (resource === "matches" || resource === "standings") {
    return [matchProvider, primary, "football-data", "mock"];
  }

  if (resource === "players") {
    return [playerProvider, primary, "mock"];
  }

  if (resource === "transfers") {
    return [transferProvider, playerProvider, primary, "mock"];
  }

  if (resource === "teams" || resource === "squad") {
    return [process.env.FOOTBALL_TEAM_PROVIDER, "mock"];
  }

  if (resource === "momentum" || resource === "signals" || resource === "analyses") {
    return ["mock"];
  }

  return [primary, "mock"];
}

function supportsFootballData(resource) {
  return !resource || LIVE_PROVIDER_RESOURCES.has(resource);
}

function resolveProviderByName(name, resource) {
  const normalized = normalizeProviderName(name);

  if (["api-football", "apifootball", "api-sports", "apisports"].includes(normalized)) {
    return apiFootballProvider.hasConfig() ? apiFootballProvider : null;
  }

  if (["football-data", "football-data.org", "football"].includes(normalized)) {
    return hasLiveProviderConfig() && supportsFootballData(resource) ? footballProvider : null;
  }

  if (normalized === "mock") {
    return mockProvider;
  }

  return null;
}

function getProvider(resource) {
  const candidates = providerCandidates(resource);
  for (const candidate of candidates) {
    const provider = resolveProviderByName(candidate, resource);
    if (provider) {
      return provider;
    }
  }

  return mockProvider;
}

module.exports = {
  getProvider,
  hasLiveProviderConfig,
  LIVE_PROVIDER_RESOURCES,
  mockProvider,
  footballProvider,
  apiFootballProvider,
  normalizeProviderName,
  providerCandidates
};
