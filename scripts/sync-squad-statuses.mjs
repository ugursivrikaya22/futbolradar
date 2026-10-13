#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { resolveSuperLigLeagueId } = require("../services/leagueResolver.js");
const { normalizeText } = require("../services/matchRadarService.js");

const root = process.cwd();
const STATUS_PATH = path.join(root, "data", "squad-statuses.json");
const PLAYERS_PATH = path.join(root, "data", "players.json");
const PUBLIC_STATUS_PATH = path.join(root, "public", "data", "squad-statuses.json");
const PUBLIC_PLAYERS_PATH = path.join(root, "public", "data", "players.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function statusForInjury(item) {
  const text = normalizeText(`${item && item.player && item.player.type} ${item && item.player && item.player.reason}`);
  if (text.includes("susp") || text.includes("ceza")) return "suspended";
  if (text.includes("doubt") || text.includes("question") || text.includes("supheli")) return "doubtful";
  return "injured";
}

function injuryKey(item) {
  const player = item && item.player || {};
  const team = item && item.team || {};
  return `${player.id || normalizeText(player.name)}|${team.id || normalizeText(team.name)}`;
}

function normalizeInjury(item, nowIso) {
  const player = item && item.player || {};
  const team = item && item.team || {};
  return {
    id: injuryKey(item),
    playerId: player.id ? String(player.id) : null,
    playerName: player.name || "",
    teamId: team.id ? String(team.id) : null,
    team: team.name || "",
    status: statusForInjury(item),
    type: player.type || null,
    reason: player.reason || null,
    fixtureId: item && item.fixture && item.fixture.id ? String(item.fixture.id) : null,
    fixtureDate: item && item.fixture && item.fixture.date ? String(item.fixture.date) : null,
    leagueId: item && item.league && item.league.id ? String(item.league.id) : null,
    source: "api-football"
  };
}

function manualAvailability(player) {
  const status = normalizeText(player && player.availabilityStatus);
  const source = normalizeText(player && player.availabilitySource);
  return status && status !== "unknown" && source !== "api-football";
}

// API-Football /injuries?league&season sezonun TÜM maçları için "bu maçı
// kaçırdı" satırlarını döndürür. Oyuncu bazında tekilleştirme tek başına,
// haftalar önce iyileşmiş oyuncuları sonsuza dek "sakat" gösteriyordu.
// Çözüm: her takım için yalnızca sağlayıcıdaki EN SON fikstür tarihine ait
// satırlar tutulur ve o tarih maxAgeDays'ten eskiyse takım listesi boş kalır.
// Tarihi olmayan satırlar (eski biçim) olduğu gibi geçer.
export const MAX_ABSENCE_AGE_DAYS = 10;

export function filterCurrentInjuries(rawInjuries, options = {}) {
  const nowMs = Date.parse(options.nowIso || new Date().toISOString());
  const maxAgeMs = (options.maxAgeDays ?? MAX_ABSENCE_AGE_DAYS) * 24 * 60 * 60 * 1000;
  const rows = Array.isArray(rawInjuries) ? rawInjuries : [];
  const dateOf = (item) => {
    const ms = Date.parse(item && item.fixture && item.fixture.date);
    return Number.isFinite(ms) ? ms : null;
  };
  const teamKey = (item) => {
    const team = item && item.team || {};
    return String(team.id || normalizeText(team.name));
  };
  const latestByTeam = new Map();
  for (const item of rows) {
    const ms = dateOf(item);
    if (ms === null || ms > nowMs + maxAgeMs) continue;
    const key = teamKey(item);
    if (!latestByTeam.has(key) || ms > latestByTeam.get(key)) latestByTeam.set(key, ms);
  }
  return rows.filter((item) => {
    const ms = dateOf(item);
    if (ms === null) return true;
    const latest = latestByTeam.get(teamKey(item));
    if (latest === undefined || ms !== latest) return false;
    return nowMs - latest <= maxAgeMs;
  });
}

export function mergeSquadStatuses(players, previousStatus, rawInjuries, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const currentInjuries = filterCurrentInjuries(rawInjuries, { nowIso, maxAgeDays: options.maxAgeDays });
  const injuries = [...new Map(currentInjuries.map((item) => {
    const normalized = normalizeInjury(item, nowIso);
    return [normalized.id, normalized];
  })).values()].filter((item) => item.playerName && item.team);

  const byProviderId = new Map(injuries.filter((item) => item.playerId).map((item) => [item.playerId, item]));
  const byNameAndTeam = new Map(injuries.map((item) => [
    `${normalizeText(item.playerName)}|${normalizeText(item.team)}`,
    item
  ]));
  let playersUpdated = 0;

  const nextPlayers = (players || []).map((player) => {
    if (manualAvailability(player)) return player;
    const providerId = String(player.providerId || "");
    const nameKey = `${normalizeText(player.name)}|${normalizeText(player.currentTeam || player.team)}`;
    const injury = (providerId && byProviderId.get(providerId)) || byNameAndTeam.get(nameKey);

    if (injury) {
      const availabilityNote = injury.reason || injury.type || "Provider absence record";
      const unchanged = player.availabilityStatus === injury.status &&
        player.availabilityNote === availabilityNote &&
        player.availabilitySource === "api-football";
      if (unchanged) return player;
      const next = { ...player, availabilityStatus: injury.status, availabilityNote, availabilitySource: "api-football", availabilityUpdatedAt: nowIso };
      playersUpdated += 1;
      return next;
    }

    if (player.availabilitySource === "api-football") {
      const next = { ...player };
      delete next.availabilityStatus;
      delete next.availabilityNote;
      delete next.availabilitySource;
      delete next.availabilityUpdatedAt;
      playersUpdated += 1;
      return next;
    }
    return player;
  });

  const grouped = new Map();
  for (const injury of injuries) {
    if (!grouped.has(injury.team)) grouped.set(injury.team, []);
    grouped.get(injury.team).push(injury);
  }
  const previousTeams = Array.isArray(previousStatus && previousStatus.teams) ? previousStatus.teams : [];
  const manualTeams = previousTeams.filter((team) => normalizeText(team.source) !== "api-football");
  const providerTeams = [...grouped.entries()].map(([team, absences]) => ({
    team,
    absenceCount: absences.length,
    keyAbsence: absences[0] ? absences[0].playerName : null,
    totalAbsenceImpact: null,
    absences,
    source: "api-football"
  }));
  const manualNames = new Set(manualTeams.map((team) => normalizeText(team.team || team.name)));
  const teams = [...manualTeams, ...providerTeams.filter((team) => !manualNames.has(normalizeText(team.team)))];
  const nextStatusFields = { status: "provider", confidence: "medium", source: "API-Football injuries endpoint", teams };
  const previousComparable = {
    status: previousStatus && previousStatus.status,
    confidence: previousStatus && previousStatus.confidence,
    source: previousStatus && previousStatus.source,
    teams: previousTeams
  };
  const statusChanged = JSON.stringify(previousComparable) !== JSON.stringify(nextStatusFields);
  const status = statusChanged ? { ...previousStatus, ...nextStatusFields, updatedAt: nowIso } : previousStatus;
  const previousProviderByTeam = new Map(previousTeams.filter((team) => normalizeText(team.source) === "api-football").map((team) => [normalizeText(team.team || team.name), JSON.stringify(team)]));
  const nextProviderByTeam = new Map(providerTeams.map((team) => [normalizeText(team.team), JSON.stringify(team)]));
  const teamKeys = new Set([...previousProviderByTeam.keys(), ...nextProviderByTeam.keys()]);
  const teamsUpdated = [...teamKeys].filter((key) => previousProviderByTeam.get(key) !== nextProviderByTeam.get(key)).length;

  return { players: nextPlayers, status, injuries: injuries.length, playersUpdated, teamsUpdated, statusChanged };
}

export async function synchronizeSquadStatuses(options = {}) {
  const provider = options.provider || apiFootballProvider;
  const resolution = options.leagueResolution || await resolveSuperLigLeagueId({ provider });
  if (resolution.status !== "resolved") {
    throw new Error(`Süper Lig identity is unavailable (${resolution.reason || "unknown"}).`);
  }
  const rawInjuries = await provider.getInjuries({ league: resolution.leagueId, season: provider.getConfig().season });

  // Empty injury responses are ambiguous across API plans. Never erase the last
  // verified absence cache just because a provider returned an empty payload.
  if (!Array.isArray(rawInjuries) || !rawInjuries.length) {
    return { skippedEmpty: true, injuries: 0, playersUpdated: 0, teamsUpdated: 0 };
  }

  return mergeSquadStatuses(
    options.players || readJson(PLAYERS_PATH, []),
    options.previousStatus || readJson(STATUS_PATH, { teams: [] }),
    rawInjuries,
    { nowIso: (options.now || new Date()).toISOString() }
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apiFootballProvider.hasConfig()) {
    throw new Error("APIFOOTBALL_API_KEY is not configured; injury/suspension synchronization cannot run.");
  }

  const result = await synchronizeSquadStatuses();
  if (result.skippedEmpty) {
    console.log("[squad-statuses] Provider returned no absence rows; last valid cache was preserved.");
  } else if (apply && (result.playersUpdated || result.statusChanged)) {
    atomicWrite(STATUS_PATH, result.status);
    atomicWrite(PLAYERS_PATH, result.players);
    if (fs.existsSync(path.dirname(PUBLIC_STATUS_PATH))) atomicWrite(PUBLIC_STATUS_PATH, result.status);
    if (fs.existsSync(path.dirname(PUBLIC_PLAYERS_PATH))) atomicWrite(PUBLIC_PLAYERS_PATH, result.players);
  }
  console.log(`[squad-statuses] injuries=${result.injuries} playersUpdated=${result.playersUpdated} teamsUpdated=${result.teamsUpdated}`);
  if (!apply && !result.skippedEmpty) console.log("[squad-statuses] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify({ source: "api-football", checked: result.injuries, updated: result.playersUpdated, errors: [] })}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[squad-statuses] ${error.message}`);
    process.exitCode = 1;
  });
}
