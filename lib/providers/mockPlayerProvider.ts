import players from "../../data/players.json";
import type { PlayerProvider, PlayerProviderRecord, PlayerQuery } from "./types";

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .trim()
    .toLowerCase();
}

function matchesQuery(player: PlayerProviderRecord, query?: PlayerQuery): boolean {
  if (!query) {
    return true;
  }

  if (query.id && player.id !== query.id) {
    return false;
  }

  if (query.team && normalizeText(player.team) !== normalizeText(query.team)) {
    return false;
  }

  if (query.league && normalizeText(player.league) !== normalizeText(query.league)) {
    return false;
  }

  if (query.position && !normalizeText(player.position).includes(normalizeText(query.position))) {
    return false;
  }

  if (query.nationality && normalizeText(player.nationality) !== normalizeText(query.nationality)) {
    return false;
  }

  return true;
}

export const mockPlayerProvider: PlayerProvider = {
  name: "mock",
  source: "FutbolRadar Mock Player Provider",
  async getPlayers(query?: PlayerQuery) {
    return (players as PlayerProviderRecord[]).filter((player) => matchesQuery(player, query));
  },
  async getPlayerById(id: string) {
    return (players as PlayerProviderRecord[]).find((player) => player.id === id) || null;
  }
};
