import { mockPlayerProvider } from "./mockPlayerProvider";
import type { PlayerProvider } from "./types";

function hasLivePlayerProviderConfig(): boolean {
  return Boolean(
    process.env.FOOTBALL_API_KEY ||
    process.env.FOOTBALL_DATA_API_KEY ||
    process.env.SPORTMONKS_API_KEY ||
    process.env.API_FOOTBALL_KEY
  );
}

export function getPlayerProvider(): PlayerProvider {
  if (hasLivePlayerProviderConfig()) {
    // TODO: Wire a real provider adapter here:
    // - football-data.org player endpoint if plan supports it
    // - API-Football players/statistics endpoint
    // - Sportmonks football players endpoint
    // The adapter must normalize into PlayerProviderRecord and must never
    // expose provider API keys to frontend responses.
    return mockPlayerProvider;
  }

  return mockPlayerProvider;
}
