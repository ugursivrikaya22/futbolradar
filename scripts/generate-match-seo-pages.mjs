#!/usr/bin/env node
/**
 * HER MAÇA ÖZEL SEO SAYFASI — /mac/<ev>-<dep>-<gün>-<ay>-<yıl> (TR)
 *                              /en/match/<home>-<away>-<month>-<day>-<year> (EN)
 *
 * Tek sayfa, üç hâl: maç öncesi ("ne zaman, saat kaçta, hangi kanalda"),
 * maç sırası (canlı skor merkezi) ve maç sonrası (kalıcı sonuç sayfası).
 * Adres üç hâlde de DEĞİŞMEZ; slug ilk üretimde `data/match-seo-pages.json`
 * siciline yazılır ve maç takvimden düşse bile silinmez.
 *
 * VERİ KAYNAKLARI (tümü derleme anında, sağlayıcıya ek istek yok):
 *   data/fixture-calendar.json        sağlayıcı takvimi: saat, stat, hakem,
 *                                     skor, olaylar, kadrolar, istatistik
 *   data/super-lig-fixtures.json      TFF sezon fikstürü (tarihi onaylı maçlar)
 *   data/matches.json                 elle doğrulanmış editoryal kayıtlar
 *   data/historical-match-archive.json bitmiş maçların kalıcı arşivi
 *   data/match-analyses.json          muhtemel 11, form, olasılık
 *   data/league-standings.json        puan durumu
 *   data/super-lig-squads.json        kadro listeleri
 *   data/squad-statuses.json          sakat / cezalı
 *   data/players.json                 golcüler, oyuncu bağlantıları
 *   data/post-match-reports.json      maç raporu bağlantısı ve özet
 *
 * Canlı hâl istemcide `match-center.js` ile /api/match-detail üzerinden
 * tazelenir; SSR HTML her zaman son doğrulanmış anlık görüntüyü taşır.
 *
 * VERİ GÜVENİLİRLİĞİ: saat, kanal, hakem, skor ve kadro TAHMİN EDİLMEZ.
 * Alan yoksa "Henüz açıklanmadı" yazılır; şemaya uydurma değer girmez.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";
import { buildH2hEntries } from "./lib/matchAnalysisSections.mjs";
import { STANDINGS_LEAGUES } from "./lib/standingsCatalog.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import {
  STR,
  absencesSectionHtml,
  analysisSectionHtml,
  clock,
  escapeHtml,
  eventsSectionHtml,
  formSectionHtml,
  h2hSectionHtml,
  hasScore,
  heroHtml,
  istanbulIso,
  lineupsSectionHtml,
  longDate,
  nextMatchesSectionHtml,
  normalizeEvents,
  relatedLinksHtml,
  scorersSectionHtml,
  shortDate,
  squadsSectionHtml,
  standingsSectionHtml,
  statsSectionHtml,
  summarySectionHtml,
  teamSlug,
  whenSectionHtml
} from "./lib/matchSeoPage.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  DOMAIN,
  STATE_RANK,
  canonicalTeamName,
  competitionNameFor,
  enPagePath,
  enPageUrl,
  enSlugFor,
  evaluateEligibility,
  identityOf,
  isIndexableEntry,
  istanbulDateParts,
  loadRegistry,
  pageStateOf,
  saveIndex,
  saveRegistry,
  trPagePath,
  trPageUrl,
  trSlugFor
} = require("../services/matchSeoPages.js");
const { canonicalStatus, istanbulDay, kickoffMs } = require("../services/matchStatus.js");
const { sameClub } = require("../services/superLigTeams.js");
const { teamHubHref } = require("../services/teamHubLinks.js");
const { isSameFixture } = require("../services/fixtureCalendar.js");
const { calculateMatchRadar } = require("../services/matchRadarService.js");
const { getPlayers } = require("../services/playerService.js");
const { normalizeText } = require("../api/_utils.js");
const { writeDynamicRoutePairs, competitionLabel } = require("../services/i18n.js");
const { CONFIRMED_FIXTURE_STATUSES } = require("../services/superLigFixtureService.js");

const CHECK_ONLY = process.argv.includes("--check");
const NOW = Date.now();
const SEASON_START = "2026-07-01";
const HUB_TR = "mac-takvimi.html";
const HUB_EN = "en/matches.html";
const MONTH_DIR_TR = "mac-takvimi";
const MONTH_DIR_EN = "en/matches";
const BIG_FOUR = ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"];
const OG_IMAGE = `${DOMAIN}/assets/og-image.png`;

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
}

const calendar = readJson("data/fixture-calendar.json", { matches: [] });
const calendarMatches = Array.isArray(calendar.matches) ? calendar.matches : [];
const fixtures = readJson("data/super-lig-fixtures.json", { rounds: [] });
const editorial = readJson("data/matches.json", []);
const editorialMatches = Array.isArray(editorial) ? editorial : (editorial.matches || []);
const archive = readJson("data/historical-match-archive.json", { records: [] });
const archiveRecords = Array.isArray(archive.records) ? archive.records : [];
const analyses = readJson("data/match-analyses.json", []);
const standings = readJson("data/league-standings.json", {});
const squads = readJson("data/super-lig-squads.json", []);
const squadStatus = readJson("data/squad-statuses.json", { teams: [] });
const teams = readJson("data/teams.json", []);
const players = getPlayers(readJson("data/players.json", []));
const reportStore = readJson("data/post-match-reports.json", { records: [] });
const reports = Array.isArray(reportStore) ? reportStore : (reportStore.records || reportStore.reports || []);
const internationalTeams = readJson("data/international-teams.json", []);
const predictedLineupsStore = readJson("data/predicted-lineups.json", { matches: [], sources: {}, asOf: null });
const predictedLineupsById = new Map(
  (Array.isArray(predictedLineupsStore.matches) ? predictedLineupsStore.matches : [])
    .filter((row) => row && row.matchId)
    .map((row) => [row.matchId, row])
);

/**
 * Editoryal "Muhtemel 11" — matchId, data/fixture-calendar.json'daki GERÇEK
 * fikstür kimliğidir (kaynak dosyanın kendi editoryal id'si değil), bu
 * yüzden `detail.naturalId` (fromCalendar.id) ile doğrudan eşleşir; ayrı bir
 * bulanık takım-adı eşleştirmesi gerekmez.
 */
function predictedLineupFor(naturalId) {
  return (naturalId && predictedLineupsById.get(naturalId)) || null;
}

/* ------------------------------------------------------------------ */
/* 1. ADAY KAYITLAR                                                     */
/* ------------------------------------------------------------------ */

const VENUE_PLACEHOLDERS = new Set(["", "-", "–", "aciklanmadi", "belirlenmedi", "bilinmiyor", "tbd"]);
function realVenue(value) {
  const key = normalizeText(value).replace(/\s+/g, " ").trim();
  return VENUE_PLACEHOLDERS.has(key) ? null : String(value).trim();
}

function scoreOf(record) {
  const score = record && record.score;
  const pick = (value) => (value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    home: pick(score && score.home),
    away: pick(score && score.away),
    halftimeHome: pick(score && score.halftimeHome),
    halftimeAway: pick(score && score.halftimeAway)
  };
}

function toCandidate(record, source) {
  record = require("../services/broadcastSchedule.js").applyVerifiedBroadcast(record);
  const eligibility = evaluateEligibility(record);
  if (!eligibility.eligible) return null;
  const homeTeam = canonicalTeamName(record.homeTeam);
  const awayTeam = canonicalTeamName(record.awayTeam);
  return {
    source,
    homeTeam,
    awayTeam,
    rawHomeTeam: record.homeTeam,
    rawAwayTeam: record.awayTeam,
    kickoff: record.kickoff,
    competitionId: eligibility.competitionId,
    league: record.league || record.competition || competitionNameFor(eligibility.competitionId, ""),
    round: record.round ?? null,
    venue: realVenue(record.venue),
    referee: record.referee || null,
    broadcast: record.broadcast || null,
    status: canonicalStatus(record.status || record.providerStatus),
    providerStatus: record.providerStatus || null,
    minute: record.minute ?? record.elapsed ?? null,
    score: scoreOf(record),
    providerIds: { ...(record.providerIds || {}) },
    homeTeamLogo: record.homeTeamLogo || null,
    awayTeamLogo: record.awayTeamLogo || null,
    fetchedAt: record.fetchedAt || record.lastVerifiedAt || record.updatedAt || null
  };
}

function collectCandidates() {
  const list = [];
  for (const match of calendarMatches) {
    const candidate = toCandidate(match, "calendar");
    if (candidate) list.push(candidate);
  }
  for (const match of editorialMatches) {
    const candidate = toCandidate(match, "editorial");
    if (candidate) list.push(candidate);
  }
  for (const record of archiveRecords) {
    const match = record && record.match;
    if (!match || String(match.kickoff || "").slice(0, 10) < SEASON_START) continue;
    const candidate = toCandidate({ ...match, providerIds: match.providerIds || (record.providerIds || null) }, "archive");
    if (candidate) list.push(candidate);
  }
  for (const round of fixtures.rounds || []) {
    for (const match of round.matches || []) {
      if (!match || !match.kickoff || !CONFIRMED_FIXTURE_STATUSES.has(match.fixtureStatus)) continue;
      const candidate = toCandidate({ ...match, league: "Süper Lig", competitionId: "super-lig", round: round.round }, "fixture");
      if (candidate) list.push(candidate);
    }
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* 2. SİCİL BİRLEŞTİRME                                                 */
/* ------------------------------------------------------------------ */

const SOURCE_PRIORITY = { calendar: 4, editorial: 3, archive: 2, fixture: 1 };

function findEntry(registry, candidate, lookup) {
  const ids = candidate.providerIds || {};
  if (ids.apiFootball && lookup.byApiFootball.has(String(ids.apiFootball))) return lookup.byApiFootball.get(String(ids.apiFootball));
  if (ids.theSportsDb && lookup.byTheSportsDb.has(String(ids.theSportsDb))) return lookup.byTheSportsDb.get(String(ids.theSportsDb));
  const identity = identityOf(candidate);
  if (identity && lookup.byIdentity.has(identity)) return lookup.byIdentity.get(identity);
  // Yazım farkı (Rizespor / Çaykur Rizespor): kulüp çifti + gün eşleşmesi.
  return registry.pages.find((entry) => isSameFixture(entry, candidate) &&
    sameClub(entry.homeTeam, candidate.homeTeam) && sameClub(entry.awayTeam, candidate.awayTeam)) || null;
}

function indexEntry(entry, lookup) {
  const ids = entry.providerIds || {};
  if (ids.apiFootball) lookup.byApiFootball.set(String(ids.apiFootball), entry);
  if (ids.theSportsDb) lookup.byTheSportsDb.set(String(ids.theSportsDb), entry);
  if (entry.identity) lookup.byIdentity.set(entry.identity, entry);
}

function mergeCandidate(entry, candidate) {
  const before = JSON.stringify(entry);
  const priority = SOURCE_PRIORITY[candidate.source] || 0;
  const entryPriority = SOURCE_PRIORITY[entry.primarySource] || 0;

  // Kimlik alanları: en güvenilir kaynak kazanır, diğerleri boşluğu doldurur.
  if (priority >= entryPriority) {
    entry.kickoff = candidate.kickoff || entry.kickoff;
    entry.primarySource = candidate.source;
  }
  if (!entry.venue && candidate.venue) entry.venue = candidate.venue;
  else if (candidate.venue && priority >= entryPriority && candidate.source !== "fixture") entry.venue = candidate.venue;
  if (candidate.referee && (priority >= entryPriority || !entry.referee)) entry.referee = candidate.referee;
  if (candidate.broadcast && (priority >= entryPriority || !entry.broadcast)) entry.broadcast = candidate.broadcast;
  if (!entry.competitionId && candidate.competitionId) entry.competitionId = candidate.competitionId;
  if (!entry.league && candidate.league) entry.league = candidate.league;
  if ((entry.round === null || entry.round === undefined) && candidate.round !== null) entry.round = candidate.round;
  if (!entry.homeTeamLogo && candidate.homeTeamLogo) entry.homeTeamLogo = candidate.homeTeamLogo;
  if (!entry.awayTeamLogo && candidate.awayTeamLogo) entry.awayTeamLogo = candidate.awayTeamLogo;
  for (const [provider, id] of Object.entries(candidate.providerIds || {})) {
    if (id && !entry.providerIds[provider]) entry.providerIds[provider] = String(id);
  }

  // DURUM GERİ GİTMEZ: bitmiş bir maç, bayat bir "SCHEDULED" kayıtla
  // "başlamadı"ya dönmez. Aynı sıradaki (ör. iki canlı kayıt) durumda daha
  // taze olan kazanır.
  const candidateRank = STATE_RANK[candidate.status] ?? 0;
  const entryRank = STATE_RANK[entry.status] ?? 0;
  const fresher = String(candidate.fetchedAt || "") >= String(entry.statusFetchedAt || "");
  if (candidateRank > entryRank || (candidateRank === entryRank && fresher && candidateRank > 0)) {
    entry.status = candidate.status;
    entry.providerStatus = candidate.providerStatus;
    entry.minute = candidate.minute;
    entry.statusFetchedAt = candidate.fetchedAt || entry.statusFetchedAt || null;
    if (candidate.score.home !== null && candidate.score.away !== null) {
      entry.score.home = candidate.score.home;
      entry.score.away = candidate.score.away;
    }
  }
  if (candidate.score.halftimeHome !== null && candidate.score.halftimeAway !== null && (entry.score.halftimeHome === null || candidateRank >= entryRank)) {
    entry.score.halftimeHome = candidate.score.halftimeHome;
    entry.score.halftimeAway = candidate.score.halftimeAway;
  }

  entry.identity = identityOf(entry) || entry.identity;
  return JSON.stringify(entry) !== before;
}

function newEntry(candidate) {
  const slug = trSlugFor(candidate.homeTeam, candidate.awayTeam, candidate.kickoff);
  const enSlug = enSlugFor(candidate.homeTeam, candidate.awayTeam, candidate.kickoff);
  if (!slug || !enSlug) return null;
  return {
    slug,
    enSlug,
    identity: identityOf(candidate),
    homeTeam: candidate.homeTeam,
    awayTeam: candidate.awayTeam,
    kickoff: candidate.kickoff,
    competitionId: candidate.competitionId,
    league: candidate.league,
    round: candidate.round,
    venue: candidate.venue,
    referee: candidate.referee,
    broadcast: candidate.broadcast,
    status: candidate.status,
    providerStatus: candidate.providerStatus,
    minute: candidate.minute,
    score: candidate.score,
    providerIds: Object.fromEntries(Object.entries(candidate.providerIds || {}).filter(([, id]) => id).map(([provider, id]) => [provider, String(id)])),
    homeTeamLogo: candidate.homeTeamLogo,
    awayTeamLogo: candidate.awayTeamLogo,
    primarySource: candidate.source,
    statusFetchedAt: candidate.fetchedAt || null,
    indexable: true,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString()
  };
}

function mergeRegistry(registry, candidates) {
  const lookup = { byApiFootball: new Map(), byTheSportsDb: new Map(), byIdentity: new Map() };
  const slugs = new Set();
  for (const entry of registry.pages) {
    indexEntry(entry, lookup);
    slugs.add(entry.slug);
  }
  let added = 0;
  let updated = 0;
  // "Güncellendi" kararı KOŞU SONUNDA verilir: aynı maçın iki sağlayıcı
  // kaydı ara adımda bir alanı ileri-geri yazabilir; koşu sonunda kayıt
  // başlangıçtakiyle aynıysa `updatedAt` ilerlemez (sicil boşuna değişmez).
  const snapshot = new Map(registry.pages.map((entry) => [entry.slug, JSON.stringify(entry)]));
  const ordered = candidates.slice().sort((left, right) => (SOURCE_PRIORITY[right.source] || 0) - (SOURCE_PRIORITY[left.source] || 0));
  for (const candidate of ordered) {
    const existing = findEntry(registry, candidate, lookup);
    if (existing) {
      if (mergeCandidate(existing, candidate)) indexEntry(existing, lookup);
      continue;
    }
    const entry = newEntry(candidate);
    if (!entry) continue;
    // Aynı slug'a ikinci bir maç düşerse (aynı gün, aynı çift, farklı
    // yarışma) kısa yarışma eki alır; ilk sayfa adresini korur.
    if (slugs.has(entry.slug)) {
      entry.slug = `${entry.slug}-${entry.competitionId}`;
      entry.enSlug = `${entry.enSlug}-${entry.competitionId}`;
    }
    slugs.add(entry.slug);
    registry.pages.push(entry);
    indexEntry(entry, lookup);
    added += 1;
  }
  for (const entry of registry.pages) {
    const before = snapshot.get(entry.slug);
    if (before !== undefined && before !== JSON.stringify(entry)) {
      entry.updatedAt = new Date(NOW).toISOString();
      updated += 1;
    }
  }
  return { added, updated };
}

/* ------------------------------------------------------------------ */
/* 3. SAYFA BAĞLAMI                                                     */
/* ------------------------------------------------------------------ */

const playerIndex = (() => {
  const byName = new Map();
  const byProvider = new Map();
  for (const player of players) {
    if (!player || !player.id) continue;
    if (!publicPlayerVerified(player)) continue;
    if (player.providerId) byProvider.set(String(player.providerId), player);
    for (const alias of [player.name, player.fullName, ...(Array.isArray(player.aliases) ? player.aliases : [])]) {
      const key = normalizeText(alias).replace(/[^a-z0-9]+/g, " ").trim();
      if (key && !byName.has(key)) byName.set(key, player);
    }
  }
  return {
    find(name, providerId) {
      if (providerId && byProvider.has(String(providerId))) return byProvider.get(String(providerId));
      const key = normalizeText(name).replace(/[^a-z0-9]+/g, " ").trim();
      return key ? byName.get(key) || null : null;
    }
  };
})();

function publicPlayerVerified(player) {
  try {
    const { publicPlayerView } = require("../services/cardCredibility.js");
    return publicPlayerView(player).verified;
  } catch {
    return false;
  }
}

function sameMatch(entry, record) {
  return record && isSameFixture(entry, record) && sameClub(entry.homeTeam, record.homeTeam) && sameClub(entry.awayTeam, record.awayTeam);
}

function detailFor(entry) {
  const ids = entry.providerIds || {};
  const fromCalendar = calendarMatches.find((match) => (ids.apiFootball && match.providerIds && String(match.providerIds.apiFootball) === String(ids.apiFootball)) || sameMatch(entry, match)) || null;
  const fromArchive = archiveRecords.find((record) => sameMatch(entry, record.match)) || null;
  const fromEditorial = editorialMatches.find((match) => sameMatch(entry, match)) || null;
  const sources = [fromCalendar, fromArchive && fromArchive.match, fromEditorial].filter(Boolean);
  const pickArray = (key, predicate) => {
    for (const source of sources) {
      const value = source[key];
      if (Array.isArray(value) && value.length && (!predicate || predicate(value))) return value;
    }
    return [];
  };
  const twoSided = (rows) => rows.some((row) => row && row.home !== undefined && row.away !== undefined);
  const events = pickArray("events");
  const substitutions = pickArray("substitutions");
  return {
    calendar: fromCalendar,
    archive: fromArchive,
    editorial: fromEditorial,
    events,
    substitutions,
    lineups: pickArray("lineups"),
    statistics: pickArray("statistics", twoSided),
    coaches: (fromEditorial && fromEditorial.coaches) || null,
    summary: (fromEditorial && fromEditorial.summary) || null,
    prediction: (fromCalendar && fromCalendar.prediction) || null,
    naturalId: (fromCalendar && fromCalendar.id) || (fromEditorial && fromEditorial.id) || null
  };
}

function analysisFor(entry) {
  return analyses.find((record) => record && record.homeContext && isSameFixture(
    entry,
    { homeTeam: record.homeContext.teamName, awayTeam: record.awayContext && record.awayContext.teamName, kickoff: record.kickoff }
  )) || null;
}

function reportFor(entry) {
  // Yalnızca gerçekten üretilmiş rapor sayfasına bağlanılır; depoda kayıt
  // olup sayfası olmayan (store-only / henüz yazılmamış) rapor bağlanmaz.
  return reports.find((report) => report && report.seo && report.seo.path && sameMatch(entry, report) &&
    report.publishState !== "store-only" && fs.existsSync(path.join(root, String(report.seo.path).replace(/^\//, "")))) || null;
}

/** Bitmiş maç havuzu (arşiv + takvim), form ve sonraki maç hesapları için. */
const finishedPool = (() => {
  const pool = [];
  const seen = new Set();
  const push = (match) => {
    if (!match || !match.homeTeam || !match.awayTeam || !match.kickoff) return;
    if (canonicalStatus(match.status || match.providerStatus) !== "FINISHED") return;
    if (!hasScore(match.score)) return;
    const key = identityOf(match);
    if (!key || seen.has(key)) return;
    seen.add(key);
    pool.push({ homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff, league: match.league || match.competition || "", score: match.score });
  };
  for (const record of archiveRecords) push(record.match);
  for (const match of calendarMatches) push(match);
  return pool.sort((left, right) => String(right.kickoff).localeCompare(String(left.kickoff)));
})();

const upcomingPool = (() => {
  const pool = [];
  const seen = new Set();
  const push = (match, league) => {
    if (!match || !match.homeTeam || !match.awayTeam || !match.kickoff) return;
    if (canonicalStatus(match.status || match.providerStatus) !== "SCHEDULED") return;
    const key = identityOf(match);
    if (!key || seen.has(key)) return;
    seen.add(key);
    pool.push({ homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff, league: league || match.league || "" });
  };
  for (const match of calendarMatches) push(match);
  for (const round of fixtures.rounds || []) for (const match of round.matches || []) if (match && match.kickoff) push(match, "Süper Lig");
  return pool.sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));
})();

function isTeamMatch(match, teamName) {
  return sameClub(match.homeTeam, teamName) || sameClub(match.awayTeam, teamName);
}

function formFor(teamName, beforeKickoff) {
  const rows = finishedPool
    .filter((match) => isTeamMatch(match, teamName) && String(match.kickoff) < String(beforeKickoff))
    .slice(0, 5)
    .map((match) => {
      const home = sameClub(match.homeTeam, teamName);
      const goalsFor = home ? match.score.home : match.score.away;
      const goalsAgainst = home ? match.score.away : match.score.home;
      const result = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
      return { result, match, label: `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}` };
    });
  return rows;
}

function nextFor(teamName, afterKickoff) {
  return upcomingPool
    .filter((match) => isTeamMatch(match, teamName) && String(match.kickoff) > String(afterKickoff))
    .slice(0, 3);
}

function logoFor(teamName, fallback) {
  if (fallback) return fallback;
  for (const table of Object.values(standings)) {
    const row = table && Array.isArray(table.table) ? table.table.find((item) => sameClub(item.team || item.name, teamName)) : null;
    if (row && row.logo) return row.logo;
  }
  const intl = internationalTeams.find((team) => team && sameClub(team.name, teamName));
  return (intl && intl.logo) || null;
}

function standingsFor(entry) {
  const table = entry.competitionId && standings[entry.competitionId];
  if (!table || !Array.isArray(table.table) || !table.table.length) return null;
  return table;
}

/* ------------------------------------------------------------------ */
/* 4. BAĞLANTI HARİTASI                                                 */
/* ------------------------------------------------------------------ */

const fileExists = (relative) => fs.existsSync(path.join(root, relative));

function teamLinks(teamName, locale, base) {
  const slug = teamSlug(canonicalTeamName(teamName));
  const isSuperLig = Boolean(teams.find((team) => sameClub(team.name, teamName)));
  if (locale === "en") {
    const page = `en/team/${slug}.html`;
    return fileExists(page) ? { page: `${base}${page}`, fixtures: `${base}${page}`, standings: `${base}en/super-lig-standings.html` } : { page: null, fixtures: null, standings: null };
  }
  if (BIG_FOUR.includes(slug)) {
    return {
      page: teamHubHref(teamName, base),
      fixtures: `${base}${slug}-maclari.html`,
      standings: `${base}${slug}-puan-durumu.html`
    };
  }
  if (isSuperLig) {
    return { page: `${base}takim-detay.html?team=${encodeURIComponent(teamName)}`, fixtures: `${base}super-lig-fikstur.html`, standings: `${base}super-lig-puan-durumu` };
  }
  return { page: null, fixtures: null, standings: null };
}

function leagueLinks(entry, locale, base) {
  const catalog = STANDINGS_LEAGUES[entry.competitionId];
  const leaguePage = `lig/${entry.competitionId}.html`;
  if (locale === "en") {
    // KATALOGDA OLMAK, SAYFANIN ÜRETİLDİĞİ ANLAMINA GELMEZ. TR sayfası olup
    // EN karşılığı olmayan yarışmalar var (1. Lig); katalog kaydına bakıp
    // bağlantı basmak, olmayan bir sayfaya götürüyordu.
    const enPage = catalog ? `en/${catalog.slugEn}.html` : null;
    return { standings: enPage && fileExists(enPage) ? `${base}${enPage}` : null, league: null };
  }
  const trPage = catalog ? `${catalog.slugTr}.html` : null;
  return {
    standings: trPage && fileExists(trPage) ? `${base}${catalog.slugTr}` : null,
    league: fileExists(leaguePage) ? `${base}${leaguePage}` : null
  };
}

/* ------------------------------------------------------------------ */
/* 5. SAYFA ÜRETİMİ                                                     */
/* ------------------------------------------------------------------ */

function pageTitles(entry, state, locale, disambiguate) {
  const home = entry.homeTeam;
  const away = entry.awayTeam;
  const score = hasScore(entry.score) ? `${entry.score.home}-${entry.score.away}` : "";
  const day = shortDate(entry.kickoff, locale);
  const hour = clock(entry.kickoff);
  let title;
  let description;
  let h1;
  if (locale === "tr") {
    if (state === "live") {
      title = `${home} ${entry.score.home} - ${entry.score.away} ${away} Canlı Skor ve Maç Anlatımı`;
      h1 = `${home} - ${away} Canlı Skor`;
      description = `${home} - ${away} maçı canlı skor, dakika dakika goller, kartlar ve maç istatistikleri. ${day} ${hour} TSİ. FutbolRadar canlı maç merkezi.`;
    } else if (state === "post") {
      title = `${home} ${score} ${away} Maç Sonucu, Goller ve İstatistikler`;
      h1 = `${home} ${score} ${away} Maç Sonucu`;
      description = `${home} ${score} ${away} maç sonucu (${day}): goller, kartlar, oyuncu değişiklikleri, ilk 11'ler ve maç istatistikleri FutbolRadar'da.`;
    } else if (state === "pending") {
      title = `${home} - ${away} Maç Sonucu ve İstatistikler`;
      h1 = `${home} - ${away} Maç Sonucu`;
      description = `${home} - ${away} maç sonucu (${day} ${hour}): nihai skor doğrulandığında goller, kartlar ve istatistikler bu sayfada. FutbolRadar.`;
    } else if (state === "postponed") {
      title = `${home} - ${away} Maçı Ertelendi`;
      h1 = `${home} - ${away} Maçı`;
      description = `${home} - ${away} maçı (${day}) ertelendi. Yeni tarih, saat ve yayın kanalı açıklandığında bu sayfa güncellenir. FutbolRadar.`;
    } else if (state === "cancelled") {
      title = `${home} - ${away} Maçı İptal Edildi`;
      h1 = `${home} - ${away} Maçı`;
      description = `${home} - ${away} maçı (${day}) iptal edildi. FutbolRadar maç takvimi.`;
    } else {
      title = `${home} - ${away} Maçı Ne Zaman, Saat Kaçta, Hangi Kanalda?`;
      h1 = `${home} - ${away} Maçı`;
      description = `${home} - ${away} maçı ne zaman, saat kaçta ve hangi kanalda? ${day} ${hour}. Muhtemel 11'ler, canlı skor, maç sonucu ve istatistikler FutbolRadar'da.`;
    }
  } else if (state === "live") {
    title = `${home} ${entry.score.home}-${entry.score.away} ${away} Live Score & Commentary`;
    h1 = `${home} vs ${away} Live Score`;
    description = `${home} vs ${away} live score, minute-by-minute goals, cards and match statistics. ${day}, ${hour} Türkiye time. FutbolRadar live match centre.`;
  } else if (state === "post") {
    title = `${home} ${score} ${away} Result, Goals & Stats`;
    h1 = `${home} ${score} ${away} Result`;
    description = `${home} ${score} ${away} result (${day}): goalscorers, cards, substitutions, line-ups and match statistics on FutbolRadar.`;
  } else if (state === "pending") {
    title = `${home} vs ${away} Result & Stats`;
    h1 = `${home} vs ${away} Result`;
    description = `${home} vs ${away} result (${day}, ${hour}): goals, cards and statistics appear here once the final score is verified. FutbolRadar.`;
  } else if (state === "postponed") {
    title = `${home} vs ${away} Postponed`;
    h1 = `${home} vs ${away}`;
    description = `${home} vs ${away} (${day}) has been postponed. This page updates when a new date, kick-off time and broadcaster are announced. FutbolRadar.`;
  } else if (state === "cancelled") {
    title = `${home} vs ${away} Cancelled`;
    h1 = `${home} vs ${away}`;
    description = `${home} vs ${away} (${day}) has been cancelled. FutbolRadar match calendar.`;
  } else {
    title = `${home} vs ${away}: Kick-off Time, TV Channel & Line-ups`;
    h1 = `${home} vs ${away}`;
    description = `When is ${home} vs ${away}, what time is kick-off and where to watch? ${day}, ${hour} Türkiye time. Probable line-ups, live score, result and stats on FutbolRadar.`;
  }
  if (disambiguate) title = `${title} (${day})`;
  return { title: `${title} | FutbolRadar`, description, h1 };
}

function schemaFor(entry, state, locale, ctx, urls) {
  const text = STR[locale];
  const startDate = istanbulIso(entry.kickoff);
  const eventStatus = state === "postponed" ? "https://schema.org/EventPostponed" : state === "cancelled" ? "https://schema.org/EventCancelled" : state === "post" ? null : "https://schema.org/EventScheduled";
  const name = state === "post" && hasScore(entry.score)
    ? `${entry.homeTeam} ${entry.score.home}-${entry.score.away} ${entry.awayTeam}`
    : `${entry.homeTeam} ${locale === "en" ? "vs" : "-"} ${entry.awayTeam}`;
  const team = (teamName, href) => ({ "@type": "SportsTeam", name: teamName, ...(href ? { url: href } : {}) });
  const competitionName = ctx.competitionName ? competitionLabel(ctx.competitionName, locale) : null;
  const graph = [];
  if (startDate) {
    graph.push({
      "@type": "SportsEvent",
      name,
      url: urls.canonical,
      description: ctx.description,
      startDate,
      ...(eventStatus ? { eventStatus } : {}),
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      sport: "Football",
      ...(entry.venue ? { location: { "@type": "Place", name: entry.venue } } : {}),
      homeTeam: team(entry.homeTeam, ctx.homeAbsolute),
      awayTeam: team(entry.awayTeam, ctx.awayAbsolute),
      competitor: [team(entry.homeTeam, ctx.homeAbsolute), team(entry.awayTeam, ctx.awayAbsolute)],
      ...(competitionName ? { superEvent: { "@type": "SportsOrganization", name: competitionName } } : {}),
      ...(ctx.channel ? { publication: { "@type": "BroadcastEvent", name: ctx.channel, isLiveBroadcast: true } } : {}),
      inLanguage: locale === "en" ? "en" : "tr"
    });
  }
  const crumbs = [
    { "@type": "ListItem", position: 1, name: text.breadcrumbHome, item: locale === "en" ? `${DOMAIN}/en` : `${DOMAIN}/` },
    { "@type": "ListItem", position: 2, name: text.allMatches, item: `${DOMAIN}/${locale === "en" ? HUB_EN.replace(/\.html$/, "") : HUB_TR.replace(/\.html$/, "")}` }
  ];
  if (competitionName && ctx.leagueAbsolute) crumbs.push({ "@type": "ListItem", position: crumbs.length + 1, name: competitionName, item: ctx.leagueAbsolute });
  crumbs.push({ "@type": "ListItem", position: crumbs.length + 1, name, item: urls.canonical });
  graph.push({ "@type": "BreadcrumbList", itemListElement: crumbs });
  return { "@context": "https://schema.org", "@graph": graph };
}

function pageHtml(entry, locale, options) {
  const { state, detail, analysis, report, disambiguate, hrefForMatch } = options;
  const base = locale === "en" ? "../../" : "../";
  const text = STR[locale];
  const titles = pageTitles(entry, state, locale, disambiguate);
  const slugValue = locale === "en" ? entry.enSlug : entry.slug;
  const canonical = locale === "en" ? enPageUrl(slugValue) : trPageUrl(slugValue);
  const relative = locale === "en" ? enPagePath(slugValue) : trPagePath(slugValue);
  const home = teamLinks(entry.homeTeam, locale, base);
  const away = teamLinks(entry.awayTeam, locale, base);
  const league = leagueLinks(entry, locale, base);
  const competitionName = competitionNameFor(entry.competitionId, entry.league) || entry.league || "";
  const channel = (() => {
    const { broadcastChannel } = require("../services/broadcastSchedule.js");
    return broadcastChannel(entry) || "";
  })();
  // Mutlak adres: takım profilleri ve lig puan durumu sayfaları uzantısız
  // kanonik taşır; lig sayfaları (`lig/<id>.html`) ve takım fikstürleri
  // uzantılı kalır. Şemadaki `url` sayfanın kendi canonical'ıyla eşleşmeli.
  const toAbsolute = (href) => {
    if (!href) return null;
    const relativeHref = href.replace(/^(\.\.\/)+/, "").split("?")[0];
    const extensionless = /^takimlar\//.test(relativeHref) || /-puan-durumu(\.html)?$/.test(relativeHref) || /^en\/[a-z0-9-]+-standings\.html$/.test(relativeHref);
    return `${DOMAIN}/${extensionless ? relativeHref.replace(/\.html$/, "") : relativeHref}`;
  };

  const ctx = {
    locale,
    base,
    state,
    playerIndex,
    homeTeam: entry.homeTeam,
    awayTeam: entry.awayTeam,
    predictedLineup: predictedLineupFor(detail.naturalId),
    predictedLineupSources: predictedLineupsStore.sources || {},
    predictedLineupAsOf: predictedLineupsStore.asOf || null,
    homeHref: home.page,
    awayHref: away.page,
    homeAbsolute: toAbsolute(home.page),
    awayAbsolute: toAbsolute(away.page),
    leagueAbsolute: toAbsolute(league.league || league.standings),
    homeLogo: logoFor(entry.homeTeam, entry.homeTeamLogo),
    awayLogo: logoFor(entry.awayTeam, entry.awayTeamLogo),
    competitionName,
    roundLabel: entry.round ? (locale === "en" ? `Matchweek ${entry.round}` : `${entry.round}. Hafta`) : "",
    channel,
    description: titles.description,
    pageHrefFor: hrefForMatch
  };

  const events = normalizeEvents({ events: detail.events, substitutions: detail.substitutions }, entry.homeTeam, entry.awayTeam);
  const radar = state === "pre" ? calculateMatchRadar({ homeTeam: entry.homeTeam, awayTeam: entry.awayTeam }, { teams, players, squadStatus }) : null;
  const h2h = buildH2hEntries({ archiveRecords, calendarRec: detail.calendar, homeName: entry.homeTeam, awayName: entry.awayTeam, sameClub, limit: 5 });
  const forms = { home: formFor(entry.homeTeam, entry.kickoff), away: formFor(entry.awayTeam, entry.kickoff) };
  const next = {
    home: nextFor(entry.homeTeam, entry.kickoff).map((match) => ({ match, href: hrefForMatch(match) })),
    away: nextFor(entry.awayTeam, entry.kickoff).map((match) => ({ match, href: hrefForMatch(match) }))
  };
  const table = standingsFor(entry);
  const reportHref = locale === "tr" && report ? `${base}${String(report.seo.path).replace(/^\//, "")}` : null;

  let sections = [];
  if (state === "post" || state === "pending") {
    sections = [
      state === "pending" ? `<section class="msp-section"><article class="card data-empty"><strong>${escapeHtml(text.pendingResult)}</strong></article></section>` : "",
      eventsSectionHtml(events, ctx),
      statsSectionHtml(detail.statistics, ctx),
      lineupsSectionHtml(detail, analysis, ctx),
      summarySectionHtml(detail.summary, reportHref, ctx),
      standingsSectionHtml(table, ctx, { post: true, fullHref: league.standings }),
      nextMatchesSectionHtml(next, ctx),
      h2hSectionHtml(h2h, ctx),
      whenSectionHtml(entry, ctx)
    ];
  } else if (state === "live") {
    sections = [
      `<section class="msp-section msp-live-note"><p class="muted-copy">${escapeHtml(text.liveNote)}</p></section>`,
      eventsSectionHtml(events, ctx),
      statsSectionHtml(detail.statistics, ctx),
      lineupsSectionHtml(detail, analysis, ctx),
      standingsSectionHtml(table, ctx, { fullHref: league.standings }),
      h2hSectionHtml(h2h, ctx),
      whenSectionHtml(entry, ctx)
    ];
  } else {
    sections = [
      state === "postponed" ? `<section class="msp-section"><article class="card data-empty"><strong>${escapeHtml(text.postponedNote)}</strong></article></section>` : "",
      state === "cancelled" ? `<section class="msp-section"><article class="card data-empty"><strong>${escapeHtml(text.cancelledNote)}</strong></article></section>` : "",
      whenSectionHtml(entry, ctx),
      lineupsSectionHtml(detail, analysis, ctx),
      squadsSectionHtml(squads, ctx),
      absencesSectionHtml(squadStatus, ctx),
      formSectionHtml(forms, ctx),
      h2hSectionHtml(h2h, ctx),
      standingsSectionHtml(table, ctx, { fullHref: league.standings }),
      scorersSectionHtml(players, ctx),
      analysisSectionHtml(radar, detail.prediction, ctx),
      // Canlı bölümlerin kabuğu: istemci başlama vuruşundan sonra doldurur.
      eventsSectionHtml([], ctx),
      statsSectionHtml([], ctx)
    ];
  }

  const related = [
    home.page ? { kicker: text.teamPage, title: entry.homeTeam, href: home.page } : null,
    away.page ? { kicker: text.teamPage, title: entry.awayTeam, href: away.page } : null,
    home.fixtures && home.fixtures !== home.page ? { kicker: text.teamFixtures, title: entry.homeTeam, href: home.fixtures } : null,
    away.fixtures && away.fixtures !== away.page ? { kicker: text.teamFixtures, title: entry.awayTeam, href: away.fixtures } : null,
    home.standings && home.standings !== league.standings ? { kicker: text.teamStandings, title: entry.homeTeam, href: home.standings } : null,
    league.standings ? { kicker: text.leagueStandings, title: competitionLabel(competitionName, locale), href: league.standings } : null,
    league.league ? { kicker: locale === "en" ? "League" : "Lig", title: competitionLabel(competitionName, locale), href: league.league } : null,
    { kicker: text.todayMatches, title: locale === "en" ? "Today's matches" : "Bugünün maçları", href: locale === "en" ? `${base}en/todays-matches.html` : `${base}bugunun-maclari.html` },
    { kicker: text.allMatches, title: locale === "en" ? "All matches" : "Tüm maçlar", href: `${base}${locale === "en" ? HUB_EN : HUB_TR}` }
  ];

  const urls = { canonical };
  const schema = schemaFor(entry, state, locale, ctx, urls);
  const indexable = isIndexableEntry(entry, NOW);
  const detailQuery = entry.providerIds && entry.providerIds.apiFootball
    ? `fixtureId=${encodeURIComponent(entry.providerIds.apiFootball)}&date=${encodeURIComponent(istanbulDay(entry.kickoff))}`
    : detail.naturalId ? `id=${encodeURIComponent(detail.naturalId)}&date=${encodeURIComponent(istanbulDay(entry.kickoff))}` : "";
  const liveTitles = {
    live: locale === "en" ? "{home} {hs}-{as} {away} Live Score & Commentary | FutbolRadar" : "{home} {hs} - {as} {away} Canlı Skor ve Maç Anlatımı | FutbolRadar",
    post: locale === "en" ? "{home} {hs}-{as} {away} Result, Goals & Stats | FutbolRadar" : "{home} {hs}-{as} {away} Maç Sonucu, Goller ve İstatistikler | FutbolRadar"
  };
  const breadcrumbCompetition = competitionName && (league.league || league.standings)
    ? `<a href="${escapeHtml(league.league || league.standings)}">${escapeHtml(competitionLabel(competitionName, locale))}</a><span>/</span>`
    : "";
  // siteHeader `base` önekini kendisi ekler; karşı dil yolu KÖK-GÖRELİ verilir.
  const altHref = locale === "en" ? trPagePath(entry.slug) : enPagePath(entry.enSlug);

  const html = `<!doctype html>
<html lang="${locale === "en" ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(titles.title)}</title>
    <meta name="description" content="${escapeHtml(titles.description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="${locale === "en" ? "en_US" : "tr_TR"}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(titles.title)}" />
    <meta property="og:description" content="${escapeHtml(titles.description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(titles.title)}" />
    <meta name="twitter:description" content="${escapeHtml(titles.description)}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
  </head>
  <body class="subpage match-seo-page">
    ${siteHeader({ base, locale, altHref })}
    <main class="container msp" data-match-center data-msp-slug="${escapeHtml(slugValue)}" data-msp-locale="${locale}" data-msp-state="${escapeHtml(state)}" data-msp-kickoff="${escapeHtml(istanbulIso(entry.kickoff) || "")}" data-msp-query="${escapeHtml(detailQuery)}" data-msp-home="${escapeHtml(entry.homeTeam)}" data-msp-away="${escapeHtml(entry.awayTeam)}" data-msp-title-live="${escapeHtml(liveTitles.live)}" data-msp-title-post="${escapeHtml(liveTitles.post)}">
      <nav class="breadcrumb" aria-label="${locale === "en" ? "Breadcrumb" : "Sayfa yolu"}"><a href="${base}${locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(text.breadcrumbHome)}</a><span>/</span><a href="${base}${locale === "en" ? HUB_EN : HUB_TR}">${escapeHtml(text.allMatches)}</a><span>/</span>${breadcrumbCompetition}<span>${escapeHtml(entry.homeTeam)} ${locale === "en" ? "vs" : "-"} ${escapeHtml(entry.awayTeam)}</span></nav>
      <h1 class="msp-h1" data-msp-h1>${escapeHtml(titles.h1)}</h1>
      ${heroHtml(entry, ctx)}
      ${sections.filter(Boolean).join("\n      ")}
      ${relatedLinksHtml(related, locale)}
      <p class="msp-source muted-copy"><b>${escapeHtml(text.dataSource)}:</b> ${escapeHtml(text.dataSourceNote)}</p>
    </main>
    ${siteFooter({ base, locale })}
    <script src="${base}site.js" defer></script>
    <script src="${base}match-center.js" defer></script>
  </body>
</html>
`;
  return { html, relative, canonical, indexable, title: titles.title };
}

/* ------------------------------------------------------------------ */
/* 6. HUB VE AY SAYFALARI                                               */
/* ------------------------------------------------------------------ */

function monthKey(kickoff) {
  const parts = istanbulDateParts(kickoff);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}` : null;
}

function monthLabel(key, locale) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(Date.UTC(year, month - 1, 15)));
}

function matchRowHtml(entry, state, locale, href) {
  const scored = hasScore(entry.score) && (state === "post" || state === "live");
  const middle = scored ? `${entry.score.home} - ${entry.score.away}` : clock(entry.kickoff);
  const competition = competitionLabel(competitionNameFor(entry.competitionId, entry.league) || entry.league || "", locale);
  return `<li class="msp-list-row is-${escapeHtml(state)}"><a href="${escapeHtml(href)}"><span class="msp-list-team">${escapeHtml(entry.homeTeam)}</span><b class="msp-list-score">${escapeHtml(middle)}</b><span class="msp-list-team is-away">${escapeHtml(entry.awayTeam)}</span><small>${escapeHtml(competition)}${state === "live" ? ` · ${escapeHtml(STR[locale].state.live)}` : ""}</small></a></li>`;
}

function groupedListHtml(entries, locale, hrefFor) {
  const byDay = new Map();
  for (const entry of entries) {
    const day = istanbulDay(entry.kickoff);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }
  return [...byDay.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, rows]) => `<section class="msp-day"><h3>${escapeHtml(longDate(`${day}T12:00:00+03:00`, locale))}</h3><ul class="msp-list">${rows
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .map((entry) => matchRowHtml(entry, pageStateOf(entry, NOW), locale, hrefFor(entry))).join("")}</ul></section>`).join("");
}

function shellHtml({ locale, title, description, canonical, base, h1, lead, body, altHref, breadcrumb, schema, indexable = true }) {
  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${locale === "en" ? "en_US" : "tr_TR"}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${OG_IMAGE}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${OG_IMAGE}" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
  </head>
  <body class="subpage match-seo-hub">
    ${siteHeader({ base, locale, altHref })}
    <main class="container msp">
      ${breadcrumb}
      <section class="hero"><div class="hero-row"><div><h1>${escapeHtml(h1)}</h1><p class="lead">${escapeHtml(lead)}</p></div></div></section>
      ${body}
    </main>
    ${siteFooter({ base, locale })}
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

function hubPages(entries, hrefForEntry) {
  const pages = [];
  const indexable = entries.filter((entry) => isIndexableEntry(entry, NOW));
  const today = istanbulDay(new Date(NOW).toISOString());
  const window = (from, to) => indexable.filter((entry) => { const day = istanbulDay(entry.kickoff); return day >= from && day <= to; });
  const dayShift = (days) => istanbulDay(new Date(NOW + days * 86400000).toISOString());
  const months = [...new Set(indexable.map((entry) => monthKey(entry.kickoff)).filter(Boolean))].sort();

  for (const locale of ["tr", "en"]) {
    const base = locale === "en" ? "../" : "./";
    const monthBase = locale === "en" ? "../../" : "../";
    const hrefFromHub = (entry) => `${base}${hrefForEntry(entry, locale)}`;
    const hrefFromMonth = (entry) => `${monthBase}${hrefForEntry(entry, locale)}`;
    const text = STR[locale];
    const hubPath = locale === "en" ? HUB_EN : HUB_TR;
    const hubUrl = `${DOMAIN}/${hubPath.replace(/\.html$/, "")}`;
    // Bugün oynanan bir maç saat ilerledikçe "post"/"pending" durumuna
    // geçebilir; gün aralığına göre filtrelemek tek başına yeterli değil —
    // aksi hâlde tamamlanmış bir maç, final skoruyla birlikte "Yaklaşan
    // maçlar" başlığı altında görünür. Durum burada da süzülür: Yaklaşan
    // listesi yalnızca henüz oynanmamış/oynanan (pre/live) maçları, Son
    // sonuçlar listesi yalnızca sonuçlanmış/sonuç bekleyen (post/pending)
    // maçları alır — ikisi ayrık kalır.
    const upcoming = window(today, dayShift(10)).filter((entry) => !["post", "pending"].includes(pageStateOf(entry, NOW)));
    const recent = window(dayShift(-7), today).filter((entry) => ["post", "pending"].includes(pageStateOf(entry, NOW)));
    const monthLinks = `<nav class="msp-months" aria-label="${escapeHtml(locale === "en" ? "Months" : "Aylar")}">${months.map((key) => `<a href="${escapeHtml(`${base}${locale === "en" ? MONTH_DIR_EN : MONTH_DIR_TR}/${key}`)}">${escapeHtml(monthLabel(key, locale))}</a>`).join("")}</nav>`;
    const body = `
      <section class="msp-section"><h2 class="msp-section-title">${escapeHtml(locale === "en" ? "Upcoming matches" : "Yaklaşan maçlar")}</h2>${upcoming.length ? groupedListHtml(upcoming, locale, hrefFromHub) : `<article class="card data-empty"><strong>${escapeHtml(locale === "en" ? "No verified fixture in the next ten days yet." : "Önümüzdeki on gün için doğrulanmış maç henüz yok.")}</strong></article>`}</section>
      <section class="msp-section"><h2 class="msp-section-title">${escapeHtml(locale === "en" ? "Recent results" : "Son sonuçlar")}</h2>${recent.length ? groupedListHtml(recent, locale, hrefFromHub) : `<article class="card data-empty"><strong>${escapeHtml(locale === "en" ? "No verified result in the last week." : "Son bir haftada doğrulanmış sonuç yok.")}</strong></article>`}</section>
      <section class="msp-section"><h2 class="msp-section-title">${escapeHtml(locale === "en" ? "Match archive by month" : "Aylara göre maç arşivi")}</h2>${monthLinks}</section>
      <section class="msp-section msp-related"><div class="msp-related-grid"><a class="match-related-card" href="${base}${locale === "en" ? "en/todays-matches.html" : "bugunun-maclari.html"}"><span>${escapeHtml(text.todayMatches)}</span><strong>${escapeHtml(locale === "en" ? "Today's programme" : "Günün programı")}</strong></a><a class="match-related-card" href="${base}${locale === "en" ? "en/live-football-scores.html" : "canli-skor.html"}"><span>${escapeHtml(text.liveScore)}</span><strong>${escapeHtml(locale === "en" ? "Live scores" : "Canlı skor")}</strong></a><a class="match-related-card" href="${base}${locale === "en" ? "en/standings.html" : "puan-durumu.html"}"><span>${escapeHtml(text.leagueStandings)}</span><strong>${escapeHtml(locale === "en" ? "Standings" : "Puan durumu")}</strong></a></div></section>`;
    const title = locale === "en" ? "Match Calendar: Fixtures, Kick-off Times & Results | FutbolRadar" : "Maç Takvimi: Fikstür, Maç Saatleri ve Sonuçlar | FutbolRadar";
    const description = locale === "en"
      ? "Every Süper Lig, European and top-five league match with its own page: kick-off time, TV channel, line-ups, live score and result. FutbolRadar match calendar."
      : "Süper Lig, Avrupa kupaları ve büyük Avrupa liglerindeki her maçın kendi sayfası: ne zaman, saat kaçta, hangi kanalda, muhtemel 11, canlı skor ve maç sonucu.";
    const breadcrumb = `<nav class="breadcrumb" aria-label="${locale === "en" ? "Breadcrumb" : "Sayfa yolu"}"><a href="${base}${locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(text.breadcrumbHome)}</a><span>/</span><span>${escapeHtml(text.allMatches)}</span></nav>`;
    const schema = { "@context": "https://schema.org", "@graph": [
      { "@type": "CollectionPage", name: title.replace(" | FutbolRadar", ""), url: hubUrl, description, inLanguage: locale === "en" ? "en" : "tr" },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: text.breadcrumbHome, item: locale === "en" ? `${DOMAIN}/en` : `${DOMAIN}/` }, { "@type": "ListItem", position: 2, name: text.allMatches, item: hubUrl }] }
    ] };
    pages.push({
      relative: hubPath,
      canonical: hubUrl,
      pair: { tr: HUB_TR, en: HUB_EN, trUrl: `${DOMAIN}/${HUB_TR.replace(/\.html$/, "")}`, enUrl: `${DOMAIN}/${HUB_EN.replace(/\.html$/, "")}` },
      html: shellHtml({ locale, title, description, canonical: hubUrl, base, h1: title.replace(" | FutbolRadar", "").split(":")[0], lead: description, body, altHref: locale === "en" ? HUB_TR : HUB_EN, breadcrumb, schema })
    });

    for (const key of months) {
      const rows = indexable.filter((entry) => monthKey(entry.kickoff) === key);
      const monthPath = `${locale === "en" ? MONTH_DIR_EN : MONTH_DIR_TR}/${key}.html`;
      const monthUrl = `${DOMAIN}/${monthPath.replace(/\.html$/, "")}`;
      const label = monthLabel(key, locale);
      const mTitle = locale === "en" ? `${label} Football Matches: Fixtures & Results | FutbolRadar` : `${label} Maçları: Fikstür ve Sonuçlar | FutbolRadar`;
      const mDescription = locale === "en"
        ? `All ${label} matches on FutbolRadar: Süper Lig, European cups and top leagues with kick-off times, channels, line-ups and results.`
        : `${label} ayındaki tüm maçlar: Süper Lig, Avrupa kupaları ve büyük ligler; maç saatleri, yayın kanalları, kadrolar ve sonuçlar FutbolRadar'da.`;
      const mBreadcrumb = `<nav class="breadcrumb" aria-label="${locale === "en" ? "Breadcrumb" : "Sayfa yolu"}"><a href="${monthBase}${locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(text.breadcrumbHome)}</a><span>/</span><a href="${monthBase}${hubPath}">${escapeHtml(text.allMatches)}</a><span>/</span><span>${escapeHtml(label)}</span></nav>`;
      const mSchema = { "@context": "https://schema.org", "@graph": [
        { "@type": "CollectionPage", name: mTitle.replace(" | FutbolRadar", ""), url: monthUrl, description: mDescription, inLanguage: locale === "en" ? "en" : "tr" },
        { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: text.breadcrumbHome, item: locale === "en" ? `${DOMAIN}/en` : `${DOMAIN}/` }, { "@type": "ListItem", position: 2, name: text.allMatches, item: hubUrl }, { "@type": "ListItem", position: 3, name: label, item: monthUrl }] }
      ] };
      pages.push({
        relative: monthPath,
        canonical: monthUrl,
        pair: { tr: `${MONTH_DIR_TR}/${key}.html`, en: `${MONTH_DIR_EN}/${key}.html`, trUrl: `${DOMAIN}/${MONTH_DIR_TR}/${key}`, enUrl: `${DOMAIN}/${MONTH_DIR_EN}/${key}` },
        html: shellHtml({ locale, title: mTitle, description: mDescription, canonical: monthUrl, base: monthBase, h1: mTitle.replace(" | FutbolRadar", ""), lead: mDescription, body: `<section class="msp-section">${groupedListHtml(rows, locale, hrefFromMonth)}</section><p class="msp-more"><a href="${monthBase}${hubPath}">${escapeHtml(text.allMatches)}</a></p>`, altHref: locale === "en" ? `${MONTH_DIR_TR}/${key}.html` : `${MONTH_DIR_EN}/${key}.html`, breadcrumb: mBreadcrumb, schema: mSchema })
      });
    }
  }
  return pages;
}

/* ------------------------------------------------------------------ */
/* 7. SİTE HARİTASI                                                     */
/* ------------------------------------------------------------------ */

function sitemapEntry(url, alt, lastmod, changefreq, priority) {
  return `  <url>\n    <loc>${url}</loc>\n    <xhtml:link rel="alternate" hreflang="tr-TR" href="${alt.tr}"/>\n    <xhtml:link rel="alternate" hreflang="en" href="${alt.en}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${alt.tr}"/>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

function isOwnSitemapEntry(entry) {
  const loc = (entry.match(/<loc>([^<]+)<\/loc>/) || [])[1] || "";
  if (!loc.startsWith(DOMAIN)) return false;
  const relative = loc.slice(DOMAIN.length);
  if (/^\/mac\/[^/]+$/.test(relative) && !relative.endsWith(".html")) return true;
  if (/^\/en\/match\/[^/]+$/.test(relative) && !relative.endsWith(".html")) return true;
  if (relative === `/${HUB_TR.replace(/\.html$/, "")}` || relative === `/${HUB_EN.replace(/\.html$/, "")}`) return true;
  if (relative.startsWith(`/${MONTH_DIR_TR}/`) || relative.startsWith(`/${MONTH_DIR_EN}/`)) return true;
  return false;
}

function updateSitemap(entries) {
  const sitemapPath = path.join(root, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) return 0;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !isOwnSitemapEntry(entry));
  const content = wrapUrlset(retained.concat(entries));
  if (content !== current) {
    fs.writeFileSync(sitemapPath, content, "utf8");
    const mirror = path.join(root, "public", "sitemap.xml");
    if (fs.existsSync(mirror)) fs.writeFileSync(mirror, content, "utf8");
  }
  return entries.length;
}

/* ------------------------------------------------------------------ */
/* 8. ÇALIŞTIR                                                          */
/* ------------------------------------------------------------------ */

function writeIfChanged(relative, html) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous === html) return false;
  if (!CHECK_ONLY) fs.writeFileSync(target, html, "utf8");
  return true;
}

const registry = loadRegistry();
const candidates = collectCandidates();
const { added, updated } = mergeRegistry(registry, candidates);

const bySlug = new Map(registry.pages.map((entry) => [entry.slug, entry]));
const lookupIndex = (() => {
  const table = { byApiFootball: new Map(), byIdentity: new Map() };
  for (const entry of registry.pages) {
    if (entry.providerIds && entry.providerIds.apiFootball) table.byApiFootball.set(String(entry.providerIds.apiFootball), entry);
    if (entry.identity) table.byIdentity.set(entry.identity, entry);
  }
  return table;
})();

function entryForMatch(match) {
  if (!match) return null;
  const ids = match.providerIds || {};
  if (ids.apiFootball && lookupIndex.byApiFootball.has(String(ids.apiFootball))) return lookupIndex.byApiFootball.get(String(ids.apiFootball));
  const identity = identityOf(match);
  if (identity && lookupIndex.byIdentity.has(identity)) return lookupIndex.byIdentity.get(identity);
  return registry.pages.find((entry) => sameMatch(entry, match)) || null;
}

const hrefForEntry = (entry, locale) => (locale === "en" ? enPagePath(entry.enSlug) : trPagePath(entry.slug)).replace(/\.html$/, "");
const hrefForMatchFactory = (locale, base) => (match) => {
  const entry = entryForMatch(match);
  return entry ? `${base}${hrefForEntry(entry, locale)}` : null;
};

// Başlık çakışması: aynı çift + aynı hâl (ör. lig ve kupa maçı) → tarih eki.
const titleCounts = new Map();
const plans = registry.pages.map((entry) => {
  const state = pageStateOf(entry, NOW);
  const tr = pageTitles(entry, state, "tr", false).title;
  const en = pageTitles(entry, state, "en", false).title;
  titleCounts.set(tr, (titleCounts.get(tr) || 0) + 1);
  titleCounts.set(en, (titleCounts.get(en) || 0) + 1);
  return { entry, state, tr, en };
});

const freshness = createFreshnessTracker(root);
const sitemapEntries = [];
const pairs = [];
let written = 0;
let unchanged = 0;
const stateCounts = { pre: 0, live: 0, post: 0, pending: 0, postponed: 0, cancelled: 0 };

for (const plan of plans) {
  const { entry, state } = plan;
  stateCounts[state] = (stateCounts[state] || 0) + 1;
  const detail = detailFor(entry);
  const analysis = analysisFor(entry);
  const report = reportFor(entry);
  const disambiguate = titleCounts.get(plan.tr) > 1 || titleCounts.get(plan.en) > 1;
  const trPage = pageHtml(entry, "tr", { state, detail, analysis, report, disambiguate, hrefForMatch: hrefForMatchFactory("tr", "../") });
  const enPage = pageHtml(entry, "en", { state, detail, analysis, report, disambiguate, hrefForMatch: hrefForMatchFactory("en", "../../") });
  for (const page of [trPage, enPage]) {
    if (writeIfChanged(page.relative, page.html)) written += 1; else unchanged += 1;
  }
  pairs.push({ tr: trPage.relative, en: enPage.relative, trUrl: trPage.canonical, enUrl: enPage.canonical });
  if (trPage.indexable) {
    const trLastmod = freshness.lastmodFor(trPage.relative, trPage.html);
    const enLastmod = freshness.lastmodFor(enPage.relative, enPage.html);
    const daysToKickoff = (kickoffMs(entry) - NOW) / 86400000;
    const changefreq = state === "live" ? "hourly" : state === "pre" && daysToKickoff <= 7 ? "daily" : state === "post" ? "monthly" : "weekly";
    const priority = state === "live" ? "0.9" : state === "pre" && daysToKickoff <= 7 ? "0.8" : state === "post" && daysToKickoff > -14 ? "0.7" : "0.6";
    const alt = { tr: trPage.canonical, en: enPage.canonical };
    sitemapEntries.push(sitemapEntry(trPage.canonical, alt, trLastmod, changefreq, priority));
    sitemapEntries.push(sitemapEntry(enPage.canonical, alt, enLastmod, changefreq, state === "live" ? "0.7" : "0.6"));
  }
}

// SİCİL DIŞI DOSYA KALMAZ: kural değişip bir kayıt sicilden düştüğünde
// (ör. çok anlamlı lig adı düzeltmesi) eski tarih slug'lı sayfa silinir.
// Hafta numaralı eski sayfalara (-rNN.html) dokunulmaz.
function pruneStalePages() {
  const expectedTr = new Set(registry.pages.map((entry) => `${entry.slug}.html`));
  const expectedEn = new Set(registry.pages.map((entry) => `${entry.enSlug}.html`));
  let removed = 0;
  // `public/` aynası da taranır: eski bir adım oraya kopya bıraktıysa aynı
  // kural uygulanır (ayna yayında kökten yönlendiriliyor, çöp kalmasın).
  for (const [dir, expected] of [["mac", expectedTr], [path.join("en", "match"), expectedEn], [path.join("public", "mac"), expectedTr], [path.join("public", "en", "match"), expectedEn]]) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith(".html") || /-\d{4}-\d{4}-r\d{2}\.html$/.test(file) || expected.has(file)) continue;
      if (!CHECK_ONLY) fs.unlinkSync(path.join(full, file));
      removed += 1;
    }
  }
  return removed;
}
const pruned = pruneStalePages();

const hubs = hubPages(registry.pages, hrefForEntry);
const hubPairs = new Map();
for (const page of hubs) {
  if (writeIfChanged(page.relative, page.html)) written += 1; else unchanged += 1;
  hubPairs.set(page.pair.tr, page.pair);
  const lastmod = freshness.lastmodFor(page.relative, page.html);
  sitemapEntries.push(sitemapEntry(page.canonical, { tr: page.pair.trUrl, en: page.pair.enUrl }, lastmod, "daily", page.relative === HUB_TR || page.relative === HUB_EN ? "0.8" : "0.5"));
}

if (!CHECK_ONLY) {
  freshness.save();
  writeDynamicRoutePairs("match-seo", pairs);
  writeDynamicRoutePairs("match-seo-hub", [...hubPairs.values()]);
  updateSitemap(sitemapEntries);
  saveRegistry(registry);
  saveIndex(registry);
}

console.log(`[match-seo-pages] sicil: ${registry.pages.length} maç (${added} yeni, ${updated} güncellendi); aday kayıt ${candidates.length}.`);
console.log(`[match-seo-pages] durumlar: ${Object.entries(stateCounts).map(([key, value]) => `${key}=${value}`).join(" ")}`);
console.log(`[match-seo-pages] sicil dışı ${pruned} eski sayfa silindi.`);
console.log(`[match-seo-pages] sayfalar: ${written} yazıldı, ${unchanged} değişmedi (TR+EN maç sayfaları + ${hubs.length} hub/ay sayfası); site haritası ${sitemapEntries.length} girdi.`);
