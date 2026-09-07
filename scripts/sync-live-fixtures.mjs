#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { findCompetition, findCompetitionByProviderId, normalizeKey } = require("../services/competitionCatalog.js");
const { canonicalStatus, istanbulDay } = require("../services/matchStatus.js");
const { sameClub, fixtureTeamNames } = require("../services/superLigTeams.js");

const root = process.cwd();
const CALENDAR_PATH = path.join(root, "data", "fixture-calendar.json");
const PUBLIC_CALENDAR_PATH = path.join(root, "public", "data", "fixture-calendar.json");
const ISTANBUL_TIME_ZONE = "Europe/Istanbul";
const TURKISH_PRIORITY = ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"];

function parseArgs(argv) {
  const args = { apply: false, mode: "hourly" };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--mode=")) args.mode = raw.slice("--mode=".length);
  }
  if (!new Set(["full", "hourly"]).has(args.mode)) {
    throw new Error(`Unsupported mode: ${args.mode}`);
  }
  return args;
}

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

function istanbulDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() + offset);
  return istanbulDate(date);
}

// Kimlik ve sorgu anahtarı olarak kullanılan takvim günü; TSİ'ye göre.
// Ham dilimleme, gece yarısını geçen maçları bir önceki güne yazıyordu ve
// `naturalId` de o yanlış günü taşıyordu (bkz. services/matchStatus.js).
function dateOnly(match) {
  return istanbulDay((match && (match.kickoff || match.date)) || "");
}

let fixtureNameCache = null;

/**
 * Sağlayıcı "Rizespor" der, TFF fikstürü "Çaykur Rizespor" — aynı kulüp
 * (services/matchSeoPages.js#canonicalTeamName ile AYNI kural, aynı kaynak
 * liste: data/super-lig-fixtures.json). Kimlik bu adla kurulmazsa
 * API-Football'un ham yazımı takvime İKİNCİ bir satır olarak eklenir:
 * "Rizespor - Alanyaspor" doğrulanmış "Çaykur Rizespor - Alanyaspor"
 * kaydından ayrı kalır ve aynı maç sitede iki kart/iki bağlantı olarak
 * yayına çıkar. Süper Lig dışı takımlarda liste eşleşmez, ad DEĞİŞMEDEN
 * döner.
 */
function canonicalTeamName(name) {
  const value = String(name || "").trim();
  if (!value) return "";
  if (!fixtureNameCache) fixtureNameCache = fixtureTeamNames();
  const exact = fixtureNameCache.find((candidate) => normalizeKey(candidate) === normalizeKey(value));
  if (exact) return exact;
  const similar = fixtureNameCache.find((candidate) => sameClub(candidate, value));
  return similar || value;
}

function fixtureIdentity(match) {
  const teams = [
    normalizeKey(canonicalTeamName(match && match.homeTeam)),
    normalizeKey(canonicalTeamName(match && match.awayTeam))
  ].sort();
  return `${teams[0]}|${teams[1]}|${dateOnly(match)}`;
}

function providerIdOf(match) {
  return String(
    (match && match.providerIds && match.providerIds.apiFootball) ||
    (match && String(match.source || "").includes("api-football") && match.providerId) ||
    ""
  );
}

function stableRecord(record) {
  const copy = { ...record };
  delete copy.fetchedAt;
  delete copy.lastProviderSeenAt;
  delete copy.staleAfter;
  delete copy.providerUpdatedAt;
  return copy;
}

function sameRecord(left, right) {
  return JSON.stringify(stableRecord(left)) === JSON.stringify(stableRecord(right));
}

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (["generatedAt", "fetchedAt", "lastProviderSeenAt", "providerUpdatedAt", "staleAfter"].includes(key)) continue;
    output[key] = stripVolatile(nested);
  }
  return output;
}

function naturalId(match) {
  return `${normalizeKey(canonicalTeamName(match.homeTeam))}-${normalizeKey(canonicalTeamName(match.awayTeam))}-${dateOnly(match)}`;
}

function compactDetail(detail) {
  if (!detail) return {};
  const output = {};
  for (const field of ["lineups", "events", "substitutions", "statistics", "players"]) {
    if (Array.isArray(detail[field]) && detail[field].length) output[field] = stripVolatile(detail[field]);
  }
  for (const field of ["analysis", "prediction"]) {
    if (detail[field] && typeof detail[field] === "object") output[field] = stripVolatile(detail[field]);
  }
  return output;
}

function normalizedIncoming(match, detail) {
  // Sağlayıcının sayısal lig kimliği varsa ÖNCE o denenir — ad hiçbir zaman
  // kimliği ezmez (bkz. services/competitionCatalog.js: resolveCompetitionId).
  const competition = findCompetitionByProviderId(match.providerLeagueId) || findCompetition(match.league);
  const providerId = String(match.providerId || match.id || "");
  const status = canonicalStatus(match.status || match.providerStatus);
  return {
    ...match,
    ...compactDetail(detail),
    id: naturalId(match),
    homeTeam: canonicalTeamName(match.homeTeam),
    awayTeam: canonicalTeamName(match.awayTeam),
    providerId,
    providerIds: { apiFootball: providerId },
    competitionId: competition ? competition.id : normalizeKey(match.league),
    status,
    live: ["LIVE", "HALFTIME", "INTERRUPTED"].includes(status),
    source: "api-football",
    dataStatus: "provider"
  };
}

function mergeScore(existingScore, incomingScore) {
  const previous = existingScore && typeof existingScore === "object" ? existingScore : {};
  const incoming = incomingScore && typeof incomingScore === "object" ? incomingScore : {};
  return Object.fromEntries(
    ["home", "away", "halftimeHome", "halftimeAway"].map((key) => [
      key,
      incoming[key] === null || incoming[key] === undefined ? previous[key] ?? null : incoming[key]
    ])
  );
}

const CALENDAR_STATE_RANK = { SCHEDULED: 0, TIMED: 0, POSTPONED: 0, CANCELLED: 0, UNKNOWN: 0, LIVE: 1, HALFTIME: 1, INTERRUPTED: 1, FINISHED: 2, AWARDED: 2 };

function calendarStateRank(status) {
  return CALENDAR_STATE_RANK[canonicalStatus(status)] ?? 0;
}

function readableScore(score) {
  return Boolean(score) && score.home !== null && score.home !== undefined && score.away !== null && score.away !== undefined;
}

/**
 * TAKVİMDE ZATEN İKİ SATIRA BÖLÜNMÜŞ AYNI MAÇI TEK SATIRDA TOPLAR.
 *
 * `fixtureIdentity`/`naturalId` artık kanonik adla kuruluyor, yani BUNDAN
 * SONRA yazılacak satırlar bir daha ikizlenmez. Ama bu onarım öncesinde
 * "Rizespor" ham yazımıyla zaten yazılmış bir satır olabilir — o satır
 * diskte kalıp her çalıştırmada sessizce yeniden yaşamaya devam eder,
 * çünkü `mergeCalendarMatches` var olan satırları asla SİLMEZ, yalnızca
 * eşleşeni günceller. Bu geçiş, güncelleme her çalıştığında takvimi tarar
 * ve aynı gün + aynı kulüp çifti (canonicalTeamName/sameClub ile) birden
 * çok satırda görünüyorsa onları birleştirir: daha ileri durumdaki
 * (CANLI/BİTEN, SCHEDULED'dan önde) kayıt taban alınır, sağlayıcı
 * kimlikleri ve okunabilir skor iki taraftan da birleştirilir.
 */
export function dedupeCalendarMatches(list) {
  const kept = [];
  let merges = 0;

  for (const match of Array.isArray(list) ? list : []) {
    const date = dateOnly(match);
    let matchIndex = -1;
    for (let index = 0; index < kept.length; index += 1) {
      const candidate = kept[index];
      if (dateOnly(candidate) !== date) continue;
      const straight = sameClub(candidate.homeTeam, match.homeTeam) && sameClub(candidate.awayTeam, match.awayTeam);
      const swapped = sameClub(candidate.homeTeam, match.awayTeam) && sameClub(candidate.awayTeam, match.homeTeam);
      if (straight || swapped) { matchIndex = index; break; }
    }

    if (matchIndex === -1) {
      kept.push(match);
      continue;
    }

    merges += 1;
    const existing = kept[matchIndex];
    const existingLeads = calendarStateRank(existing.status) >= calendarStateRank(match.status);
    const primary = existingLeads ? existing : match;
    const secondary = existingLeads ? match : existing;
    // Sade `{...secondary, ...primary}` ileri durumdaki kaydın BOŞ
    // alanlarının (ör. sağlayıcı saha vermediyse `venue: null`) diğer
    // kaydın DOLU alanının üzerine yazmasına yol açıyordu — "canlı" kayıt
    // kazanınca doğrulanmış stat adı sessizce kayboluyordu. `id` de aynı
    // nedenle `existing`e (takvimde zaten duran, başka yerlerden referans
    // alınmış olabilecek kayıt) sabitlenir; hangi tarafın "ileride" olduğu
    // kimliği DEĞİŞTİRMEZ.
    kept[matchIndex] = {
      ...secondary,
      ...primary,
      id: existing.id || match.id,
      homeTeam: canonicalTeamName(primary.homeTeam),
      awayTeam: canonicalTeamName(primary.awayTeam),
      venue: primary.venue || secondary.venue || null,
      score: readableScore(primary.score) ? primary.score : (readableScore(secondary.score) ? secondary.score : primary.score),
      providerIds: { ...(secondary.providerIds || {}), ...(primary.providerIds || {}) }
    };
  }

  return { matches: kept, merges };
}

export function mergeCalendarMatches(existingMatches, incomingMatches) {
  const output = Array.isArray(existingMatches) ? existingMatches.map((item) => ({ ...item })) : [];
  const byProviderId = new Map();
  const byIdentity = new Map();
  output.forEach((match, index) => {
    const providerId = providerIdOf(match);
    if (providerId) byProviderId.set(providerId, index);
    byIdentity.set(fixtureIdentity(match), index);
  });

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const raw of incomingMatches || []) {
    const incoming = normalizedIncoming(raw.match || raw, raw.detail || null);
    const providerId = providerIdOf(incoming);
    const identity = fixtureIdentity(incoming);
    const index = (providerId && byProviderId.has(providerId))
      ? byProviderId.get(providerId)
      : byIdentity.get(identity);

    if (index === undefined) {
      output.push(incoming);
      const addedIndex = output.length - 1;
      byProviderId.set(providerId, addedIndex);
      byIdentity.set(identity, addedIndex);
      added += 1;
      continue;
    }

    const existing = output[index];
    const existingSportsDbId = existing.providerIds && existing.providerIds.theSportsDb
      ? existing.providerIds.theSportsDb
      : String(existing.source || "").includes("thesportsdb") ? existing.providerId : null;
    const merged = {
      ...existing,
      ...incoming,
      id: existing.id || incoming.id,
      providerId,
      providerIds: {
        ...(existing.providerIds || {}),
        ...(existingSportsDbId ? { theSportsDb: String(existingSportsDbId) } : {}),
        apiFootball: providerId
      },
      score: mergeScore(existing.score, incoming.score),
      source: String(existing.source || "").includes("thesportsdb")
        ? "api-football+thesportsdb"
        : "api-football"
    };

    if (sameRecord(existing, merged)) {
      unchanged += 1;
      continue;
    }

    output[index] = merged;
    updated += 1;
  }

  const repaired = dedupeCalendarMatches(output);
  repaired.matches.sort((left, right) => String(left.kickoff || "").localeCompare(String(right.kickoff || "")));
  return { matches: repaired.matches, added, updated, unchanged, deduped: repaired.merges };
}

function priorityScore(match) {
  const names = `${normalizeKey(match.homeTeam)} ${normalizeKey(match.awayTeam)}`;
  const clubIndex = TURKISH_PRIORITY.findIndex((club) => names.includes(club));
  if (clubIndex !== -1) return clubIndex;
  if (normalizeKey(match.country) === "turkey" || normalizeKey(match.league).includes("super-lig")) return 10;
  return 50;
}

export function selectDetailTargets(matches, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? 8;
  return (matches || [])
    .filter((match) => {
      const kickoff = Date.parse(match.kickoff);
      if (Number.isNaN(kickoff)) return false;
      const state = canonicalStatus(match.status || match.providerStatus);
      if (["LIVE", "HALFTIME", "INTERRUPTED"].includes(state)) return true;
      if (state === "FINISHED") return nowMs - kickoff >= 0 && nowMs - kickoff <= 8 * 60 * 60 * 1000;
      return state === "SCHEDULED" && kickoff - nowMs >= -30 * 60 * 1000 && kickoff - nowMs <= 2 * 60 * 60 * 1000;
    })
    .sort((left, right) => priorityScore(left) - priorityScore(right) || String(left.kickoff).localeCompare(String(right.kickoff)))
    .slice(0, limit);
}

async function fetchFixtures(provider, mode, now) {
  const today = istanbulDate(now);
  const dates = mode === "full"
    ? [addDays(today, -1), today, addDays(today, 1)]
    : [addDays(today, -1), today];
  const byProviderId = new Map();
  const errors = [];
  let successfulRequests = 0;

  for (const query of [{ live: true }, ...dates.map((date) => ({ date }))]) {
    try {
      const matches = await provider.getFixtures(query);
      successfulRequests += 1;
      for (const match of matches || []) byProviderId.set(String(match.providerId || match.id), match);
    } catch (error) {
      errors.push({ query, message: error.message, code: error.code || null });
    }
  }

  if (!successfulRequests) {
    throw new Error(`API-Football fixture requests all failed: ${errors.map((item) => item.code || item.message).join(", ")}`);
  }
  return { matches: [...byProviderId.values()], errors, successfulRequests };
}

export async function synchronizeLiveFixtures(options = {}) {
  const provider = options.provider || apiFootballProvider;
  const mode = options.mode || "hourly";
  const now = options.now || new Date();
  const previous = options.previous || readJson(CALENDAR_PATH, { matches: [] });
  const fetched = await fetchFixtures(provider, mode, now);
  const detailTargets = selectDetailTargets(fetched.matches, { nowMs: now.getTime(), limit: mode === "full" ? 12 : 8 });
  const details = new Map();
  const detailErrors = [];

  for (const match of detailTargets) {
    try {
      const detail = await provider.getMatchDetail({ fixtureId: match.providerId || match.id, date: dateOnly(match) });
      if (detail) details.set(String(match.providerId || match.id), detail);
    } catch (error) {
      detailErrors.push({ fixtureId: String(match.providerId || match.id), message: error.message, code: error.code || null });
    }
  }

  const incoming = fetched.matches.map((match) => ({
    match,
    detail: details.get(String(match.providerId || match.id)) || null
  }));
  const merged = mergeCalendarMatches(previous.matches || [], incoming);
  return {
    output: {
      ...previous,
      source: "TheSportsDB + API-Football",
      providers: ["thesportsdb", "api-football"],
      fetchedAt: (merged.added || merged.updated) ? now.toISOString() : previous.fetchedAt,
      matches: merged.matches
    },
    summary: {
      source: "api-football",
      checked: fetched.matches.length,
      detailsChecked: detailTargets.length,
      added: merged.added,
      updated: merged.updated,
      unchanged: merged.unchanged,
      deduped: merged.deduped,
      errors: [...fetched.errors, ...detailErrors]
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!apiFootballProvider.hasConfig()) {
    throw new Error("APIFOOTBALL_API_KEY is not configured; live fixture synchronization cannot run.");
  }

  const { output, summary } = await synchronizeLiveFixtures({ mode: args.mode });
  const changed = summary.added > 0 || summary.updated > 0 || summary.deduped > 0;
  if (args.apply && changed) {
    atomicWrite(CALENDAR_PATH, output);
    if (fs.existsSync(path.dirname(PUBLIC_CALENDAR_PATH))) atomicWrite(PUBLIC_CALENDAR_PATH, output);
  }

  console.log(`[live-fixtures] checked=${summary.checked} details=${summary.detailsChecked} added=${summary.added} updated=${summary.updated} unchanged=${summary.unchanged} deduped=${summary.deduped} errors=${summary.errors.length}`);
  if (!changed) console.log("[live-fixtures] No changed fixture data; existing calendar was left byte-for-byte unchanged.");
  else if (!args.apply) console.log("[live-fixtures] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify(summary)}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[live-fixtures] ${error.message}`);
    process.exitCode = 1;
  });
}
