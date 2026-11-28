#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { resolveSuperLigLeagueId } = require("../services/leagueResolver.js");
const { normalizeText } = require("../services/matchRadarService.js");
const { checkStandings } = require("../services/standingsIntegrity.js");
const { computeTeamMomentum } = require("../services/momentumService.js");

const root = process.cwd();
const TEAMS_PATH = path.join(root, "data", "teams.json");
const PUBLIC_TEAMS_PATH = path.join(root, "public", "data", "teams.json");

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function formEntry(value) {
  const token = String(value || "").toUpperCase();
  if (token === "W") return { label: "G", result: "win" };
  if (token === "L") return { label: "M", result: "loss" };
  return { label: "B", result: "draw" };
}

function standingFields(row, previous, nowIso, season) {
  const providerForm = Array.isArray(row.form) ? row.form.filter(Boolean).map(formEntry) : [];
  const next = {
    rank: row.rank,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalDifference,
    points: row.points,
    average: row.average,
    standingsSeason: season,
    standingsStatus: Number(row.played || 0) > 0 ? "live" : (previous.standingsStatus || "preseason")
  };
  if (providerForm.length) next.form = providerForm;

  const changed = Object.entries(next).some(([key, value]) => JSON.stringify(previous[key]) !== JSON.stringify(value));
  return changed ? { ...next, lastStandingsSyncedAt: row.fetchedAt || nowIso } : null;
}

/**
 * Form dizisi güncellenince form skoru ve momentum da aynı hesaptan
 * yenilenir. Beş mağlubiyet, dosyada kalan sezon öncesi 71'i taşımaz.
 * Formu olmayan takıma skor uydurulmaz (beş beraberlik doldurulmaz).
 */
function refreshComputedForm(team, matches) {
  const form = Array.isArray(team && team.form) ? team.form.filter(Boolean) : [];
  if (!form.length) return team;
  const computed = computeTeamMomentum(team, matches || [], [team]);
  if (team.formScore === computed.formScore && team.momentum === computed.momentum) return team;
  return { ...team, formScore: computed.formScore, momentum: computed.momentum };
}

export function mergeStandings(teams, standings, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const season = options.season || null;
  const matches = options.matches || [];
  const byProviderId = new Map((standings || []).filter((row) => row.providerId).map((row) => [String(row.providerId), row]));
  const byName = new Map((standings || []).map((row) => [normalizeText(row.team || row.name), row]));
  let updated = 0;
  let matched = 0;

  const merged = (teams || []).map((team) => {
    const row = (team.providerId && byProviderId.get(String(team.providerId))) || byName.get(normalizeText(team.name));
    let next = team;
    if (row) {
      matched += 1;
      const fields = standingFields(row, team, nowIso, season);
      if (fields) next = { ...team, ...fields };
    }
    const scored = refreshComputedForm(next, matches);
    if (scored !== next || next !== team) updated += 1;
    return scored;
  });

  return { teams: merged, updated, matched };
}

function seasonLabel(season) {
  const start = Number(season);
  return Number.isFinite(start) ? `${start}/${String(start + 1).slice(-2)}` : null;
}

export async function synchronizeStandings(options = {}) {
  const provider = options.provider || apiFootballProvider;
  const teams = options.teams || JSON.parse(fs.readFileSync(TEAMS_PATH, "utf8"));
  const resolution = options.leagueResolution || await resolveSuperLigLeagueId({ provider });
  if (resolution.status !== "resolved") {
    throw new Error(`Süper Lig identity is unavailable (${resolution.reason || "unknown"}).`);
  }

  const standings = await provider.getStandings({ league: resolution.leagueId });
  const currentTeamCount = teams.filter((team) => team.isCurrentSuperLigTeam).length;
  const minimumRows = Math.max(10, Math.floor(currentTeamCount * 0.7));
  if (!Array.isArray(standings) || standings.length < minimumRows) {
    throw new Error(`Standings safety check rejected ${standings ? standings.length : 0} rows; expected at least ${minimumRows}.`);
  }

  const config = provider.getConfig();
  let matches = options.matches;
  if (!matches) {
    try {
      matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
    } catch {
      matches = [];
    }
  }
  const merged = mergeStandings(teams, standings, {
    nowIso: (options.now || new Date()).toISOString(),
    season: seasonLabel(config.season),
    matches
  });

  // ARİTMETİK KAPISI YAZMADAN ÖNCE.
  //
  // Satır sayısı koruması kısmi cevabı tamamen elemiyor: 18 takımlık ligde
  // eşik 12, yani sağlayıcı 12-17 satır döndürdüğünde birleştirme yapılıyor
  // ve KAPSANMAYAN takımlar eski sıralarında kalıyor. Sonuç, aynı sıra
  // numarasının iki takımda birden göründüğü çelişkili bir tablo — okuyucuya
  // "1. Galatasaray" ve "1. Amed" aynı anda gösterilebilirdi.
  //
  // Tablo bir bütün olarak doğru ya da yanlıştır; yarısı doğru bir puan
  // tablosu yayımlanmaz. Kural services/standingsIntegrity.js'de, QA da
  // aynı kuralı kullanıyor.
  const violations = checkStandings(merged.teams);
  if (violations.length) {
    throw new Error(
      `Standings integrity check rejected the merged table (${violations.length} violation): ${violations.slice(0, 3).join(" | ")}`
    );
  }

  return { ...merged, checked: standings.length, leagueId: resolution.leagueId };
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apiFootballProvider.hasConfig()) {
    throw new Error("APIFOOTBALL_API_KEY is not configured; standings synchronization cannot run.");
  }

  const result = await synchronizeStandings();
  if (apply && result.updated) {
    atomicWrite(TEAMS_PATH, result.teams);
    if (fs.existsSync(path.dirname(PUBLIC_TEAMS_PATH))) atomicWrite(PUBLIC_TEAMS_PATH, result.teams);
  }
  console.log(`[standings] checked=${result.checked} matched=${result.matched} updated=${result.updated}`);
  if (!result.updated) console.log("[standings] No standings values changed; teams.json was not rewritten.");
  else if (!apply) console.log("[standings] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify({ source: "api-football", checked: result.checked, updated: result.updated, errors: [] })}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[standings] ${error.message}`);
    process.exitCode = 1;
  });
}
