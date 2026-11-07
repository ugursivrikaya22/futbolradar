/** API-Football-only, competition+season-scoped inputs. No provider calls. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  filterActiveLeaderRows,
} = require("../../services/playerStatsEligibility.js");
export const STAT_LEAGUES = [
  ["premier-league", "Premier Lig", "39", "premier-lig"],
  ["la-liga", "La Liga", "140", "la-liga"],
  ["serie-a", "Serie A", "135", "serie-a"],
  ["bundesliga", "Bundesliga", "78", "bundesliga"],
  ["ligue-1", "Ligue 1", "61", "ligue-1"],
  ["sampiyonlar-ligi", "Şampiyonlar Ligi", "2", "sampiyonlar-ligi"],
].map(([id, name, leagueId, slug]) => ({
  id,
  name,
  leagueId,
  slug,
  url: `/${slug}-istatistikleri`,
}));
export const escapeHtml = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const seasonLabel = (season) =>
  `${season}/${String(Number(season) + 1).slice(-2)}`;
export function availableSeasons(league, leaders, standings) {
  const values = Object.values(leaders.cache || {})
    .filter(
      (e) =>
        e.competitionId === league.id && String(e.leagueId) === league.leagueId,
    )
    .map((e) => Number(e.season));
  if (standings[league.id]) values.push(Number(standings[league.id].season));
  return [
    ...new Set(
      values.filter((v) => Number.isInteger(v) && v >= 2000 && v <= 2100),
    ),
  ].sort((a, b) => b - a);
}
export function statisticsFor(
  league,
  season,
  leaders,
  standings,
  players = [],
) {
  const providerSource = String(leaders.source || "").startsWith(
    "api-football:",
  );
  function list(kind, metric) {
    const e = leaders.cache?.[`${kind}:${league.leagueId}:${season}`];
    if (
      !providerSource ||
      !e ||
      e.competitionId !== league.id ||
      String(e.leagueId) !== league.leagueId ||
      Number(e.season) !== season
    )
      return { rows: [], updatedAt: null };
    const valid = (e.rows || []).filter(
      (r) =>
        String(r.leagueId) === league.leagueId &&
        Number(r.season) === season &&
        /^\d+$/.test(String(r.providerId)) &&
        r.name &&
        Number(r.appearances) > 0 &&
        Number.isFinite(r[metric]) &&
        r[metric] > 0,
    );
    const rows = filterActiveLeaderRows(valid, players, { superLigOnly: false })
      .sort(
        (a, b) =>
          b[metric] - a[metric] ||
          String(a.name).localeCompare(String(b.name), "tr"),
      )
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return { rows, updatedAt: e.updatedAt || null };
  }
  const s = standings[league.id];
  const teams =
    Number(s?.season) === season
      ? (s.table || []).filter(
          (t) =>
            t.source === "api-football" &&
            String(t.leagueId) === league.leagueId &&
            Number(t.season) === season &&
            Number(t.played) > 0,
        )
      : [];
  const scorers = list("topscorers", "goals"),
    assists = list("assists", "assists");
  const profiles = [
    ...new Map(
      [...scorers.rows, ...assists.rows].map((r) => [String(r.providerId), r]),
    ).values(),
  ];
  // A table alone is useful, but a sparse/unverified landing must not enter search.
  return {
    scorers,
    assists,
    teams,
    profiles,
    standingsUpdatedAt: teams.length ? s.updatedAt : null,
    indexable:
      teams.length >= 8 && scorers.rows.length >= 5 && assists.rows.length >= 5,
  };
}
