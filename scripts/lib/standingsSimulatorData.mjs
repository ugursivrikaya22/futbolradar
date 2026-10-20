/**
 * PUAN DURUMU SİMÜLATÖRÜ VERİSİ — yalnızca kaynağı olan lig.
 *
 * Süper Lig: resmî tablo `data/teams.json` (sync-standings, bütünlük
 * denetimli), fikstür `data/super-lig-fixtures.json` (TFF), oynanmış maçlar
 * `data/historical-match-archive.json` + `data/fixture-calendar.json`.
 * Kalan maç kümesi her takım için `oynanan + kalan = 2·(takım-1)` eşitliğini
 * sağlamıyorsa ya da bu eşitliği sağlayan birden fazla küme varsa veri
 * REDDEDİLİR; sayfa simülasyon basmaz. Diğer ligler için tam sezon fikstürü
 * kaynağı olmadığından kayıt üretilmez.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sameClub } = require("../../services/superLigTeams.js");
const { superLigTeamPages } = require("../../services/superLigTeamPages.js");

const MAX_UNCERTAIN = 16;

function readJson(root, file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
}

function time(value) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : null;
}

function isSuperLig(match) {
  return match && (match.competitionId === "super-lig" || /^s[üu]per lig$/i.test(String(match.competition || match.league || "").trim()));
}

/** Kalan maçları sayım kısıtıyla çözer; tek geçerli çözüm yoksa hata döner. */
export function resolveRemaining({ teamIds, played, fixtures, isFinished, standingsAt }) {
  const perTeam = 2 * (teamIds.length - 1);
  const remaining = [];
  const uncertain = [];
  const started = (match) => standingsAt !== null && time(match.kickoff) !== null && time(match.kickoff) < standingsAt;
  const lastStartedRound = Math.max(0, ...fixtures.filter(started).map((match) => match.round));
  for (const match of fixtures) {
    if (isFinished(match)) continue;
    const kickoff = time(match.kickoff);
    const future = kickoff !== null ? standingsAt !== null && kickoff >= standingsAt : match.round > lastStartedRound;
    (future ? remaining : uncertain).push(match);
  }
  const need = new Map(teamIds.map((id) => [id, perTeam - (played.get(id) || 0)]));
  for (const match of remaining) {
    need.set(match.home, need.get(match.home) - 1);
    need.set(match.away, need.get(match.away) - 1);
  }
  if ([...need.values()].some((n) => n < 0)) return { error: "kalan maç sayısı oynanan maçlarla çelişiyor" };
  if (uncertain.length > MAX_UNCERTAIN) return { error: `${uncertain.length} maçın durumu belirsiz` };
  const solutions = [];
  for (let mask = 0; mask < 1 << uncertain.length && solutions.length < 2; mask += 1) {
    const left = new Map(need);
    uncertain.forEach((match, index) => {
      if (mask & (1 << index)) {
        left.set(match.home, left.get(match.home) - 1);
        left.set(match.away, left.get(match.away) - 1);
      }
    });
    if ([...left.values()].every((n) => n === 0)) solutions.push(mask);
  }
  if (solutions.length !== 1) return { error: solutions.length ? "kalan maç kümesi tek anlamlı değil" : "kalan maç kümesi oynanan maç sayılarıyla eşleşmiyor" };
  const extra = uncertain.filter((_, index) => solutions[0] & (1 << index));
  return { remaining: [...remaining, ...extra].sort((a, b) => a.round - b.round || (time(a.kickoff) ?? Infinity) - (time(b.kickoff) ?? Infinity)), inferred: extra.length };
}

export function buildSuperLigSimulator(root) {
  const teams = readJson(root, "data/teams.json", []).filter((team) => team.isCurrentSuperLigTeam && team.rank != null && team.points != null);
  const fixtureFile = readJson(root, "data/super-lig-fixtures.json", null);
  if (teams.length < 4 || !fixtureFile || !Array.isArray(fixtureFile.rounds)) return { ok: false, reason: "puan durumu ya da fikstür kaydı yok" };
  for (const team of teams) {
    if (Number(team.played) !== Number(team.won) + Number(team.drawn) + Number(team.lost)) return { ok: false, reason: `${team.name}: O ≠ G+B+M` };
  }
  const slugs = new Map(superLigTeamPages({ root, teams }).map((entry) => [String(entry.id), entry.slug]));
  const nameCache = new Map();
  const teamOf = (name) => {
    if (!nameCache.has(name)) {
      const hits = teams.filter((team) => sameClub(team.name, name));
      nameCache.set(name, hits.length === 1 ? String(hits[0].id) : null);
    }
    return nameCache.get(name);
  };
  const fixtures = [];
  for (const round of fixtureFile.rounds) {
    for (const match of round.matches || []) {
      const home = teamOf(match.homeTeam);
      const away = teamOf(match.awayTeam);
      if (!home || !away || home === away) return { ok: false, reason: `fikstür takımı eşleşmedi: ${match.homeTeam} - ${match.awayTeam}` };
      fixtures.push({ id: match.id, round: Number(round.round), label: round.label || `${round.round}. Hafta`, home, away, kickoff: match.kickoff || null });
    }
  }
  const archive = readJson(root, "data/historical-match-archive.json", { records: {} });
  const calendar = readJson(root, "data/fixture-calendar.json", { matches: [] });
  const standingsAt = time(teams.map((team) => team.lastStandingsSyncedAt).filter(Boolean).sort().at(-1));
  const seasonStart = time(fixtureFile.seasonStart);
  const finished = new Set();
  const results = [...Object.values(archive.records || {}).map((record) => record && record.match), ...(calendar.matches || [])];
  for (const result of results) {
    if (!isSuperLig(result) || result.status !== "FINISHED") continue;
    const kickoff = time(result.kickoff);
    if (kickoff === null || (seasonStart !== null && kickoff < seasonStart - 86400000)) continue;
    if (standingsAt !== null && kickoff >= standingsAt) continue;
    const home = teamOf(result.homeTeam);
    const away = teamOf(result.awayTeam);
    if (home && away) finished.add(`${home}|${away}`);
  }
  const played = new Map(teams.map((team) => [String(team.id), Number(team.played)]));
  const resolved = resolveRemaining({
    teamIds: teams.map((team) => String(team.id)),
    played,
    fixtures,
    isFinished: (match) => finished.has(`${match.home}|${match.away}`),
    standingsAt
  });
  if (resolved.error) return { ok: false, reason: resolved.error };
  const rows = teams.slice().sort((a, b) => Number(a.rank) - Number(b.rank)).map((team) => ({
    id: String(team.id),
    name: team.name,
    slug: slugs.get(String(team.id)) || null,
    rank: Number(team.rank),
    played: Number(team.played),
    won: Number(team.won),
    drawn: Number(team.drawn),
    lost: Number(team.lost),
    goalsFor: Number(team.goalsFor),
    goalsAgainst: Number(team.goalsAgainst),
    points: Number(team.points)
  }));
  return {
    ok: true,
    data: {
      league: "super-lig",
      name: "Süper Lig",
      season: fixtureFile.season || null,
      standingsAt: standingsAt ? new Date(standingsAt).toISOString() : null,
      fixturesAt: fixtureFile.lastVerifiedAt || null,
      inferred: resolved.inferred,
      rows,
      fixtures: resolved.remaining.map(({ id, round, label, home, away, kickoff }) => ({ id, round, label, home, away, kickoff }))
    }
  };
}
