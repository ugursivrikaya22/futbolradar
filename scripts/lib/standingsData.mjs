/**
 * PUAN DURUMU VERİ OKUYUCU — `standingsCatalog.mjs`'teki her kayıt için tek
 * biçimli satır listesi üretir.
 *
 * İKİ KAYNAK VAR, KASITLI OLARAK AYRI:
 *   - "teams": yalnızca Süper Lig. `data/teams.json`, `sync-standings.mjs`
 *     tarafından bütünlük denetiminden (services/standingsIntegrity.js)
 *     geçirilerek yazılır — bu yüzden en güvenilir kaynak burada.
 *   - "league-standings": diğer 8 yarışma. `data/league-standings.json`,
 *     `sync-league-standings.mjs` tarafından yazılır; kayıt yoksa (henüz
 *     senkronlanmamış ya da coverage kapalıyken eklenmiş bir kayıt) `hasData:
 *     false` döner — UYDURMA SATIR YOK, çağıran dürüst bir boş durum basar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let teamsCache = null;
let leagueStandingsCache = null;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function loadTeams() {
  if (!teamsCache) teamsCache = readJson(path.join("data", "teams.json"));
  return teamsCache;
}

function loadLeagueStandings() {
  if (!leagueStandingsCache) {
    try {
      leagueStandingsCache = readJson(path.join("data", "league-standings.json"));
    } catch {
      leagueStandingsCache = {};
    }
  }
  return leagueStandingsCache;
}

function normalizeRow(row) {
  return {
    id: row.id !== undefined && row.id !== null ? String(row.id) : (row.providerId ? String(row.providerId) : null),
    rank: row.rank ?? null,
    name: row.name || row.team || "",
    logo: row.logo || null,
    played: row.played ?? null,
    won: row.won ?? null,
    drawn: row.drawn ?? null,
    lost: row.lost ?? null,
    goalsFor: row.goalsFor ?? null,
    goalsAgainst: row.goalsAgainst ?? null,
    goalDifference: row.goalDifference ?? null,
    points: row.points ?? null
  };
}

function fromTeams() {
  const teams = loadTeams().filter((team) =>
    team.isCurrentSuperLigTeam &&
    Number(team.played) > 0 &&
    team.points !== null && team.points !== undefined &&
    team.rank !== null && team.rank !== undefined);
  const sorted = teams.slice().sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
  const updatedAt = sorted.map((team) => team.lastStandingsSyncedAt).filter(Boolean).sort().at(-1) || null;
  return { hasData: sorted.length > 0, updatedAt, rows: sorted.map(normalizeRow) };
}

function fromLeagueStandings(competitionId) {
  const entry = loadLeagueStandings()[competitionId];
  const table = entry && Array.isArray(entry.table) ? entry.table : [];
  const sorted = table.slice().sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
  return { hasData: sorted.length > 0, updatedAt: (entry && entry.updatedAt) || null, rows: sorted.map(normalizeRow) };
}

/** @returns {{hasData: boolean, updatedAt: string|null, rows: Array}} */
export function getStandings(catalogEntry) {
  return catalogEntry.dataSource === "teams" ? fromTeams() : fromLeagueStandings(catalogEntry.id);
}

/** Aynı sonucu ilk `limit` satırla sınırlar (ana sayfa widget'ı için). */
export function getTopStandings(catalogEntry, limit = 5) {
  const data = getStandings(catalogEntry);
  return { ...data, rows: data.rows.slice(0, limit), total: data.rows.length };
}
