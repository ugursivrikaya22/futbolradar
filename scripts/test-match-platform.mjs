import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const {
  BROADCAST_STATUSES,
  contentQualityScore,
  dateInTimeZone,
  dedupeMatches,
  isFriendlyCompetition,
  isIndexableMatch,
  matchSlug,
  normalizeBroadcast,
  normalizeCompetition,
  normalizeMatchRecord,
  normalizeMatchStatus,
  schemaEventStatus,
  slugify,
  timeInIstanbul
} = require("../services/matchDataService.js");
const { createMatchDataProvider } = require("../services/providers/matchDataProvider.js");
const { synchronizeMatchDate } = require("../services/matchSyncService.js");

assert.equal(slugify("Çaykur Rizespor - Göztepe"), "caykur-rizespor-goztepe", "Turkish slug normalization failed");
assert.equal(dateInTimeZone("2026-07-21T22:30:00Z"), "2026-07-22", "Istanbul date conversion failed");
assert.equal(timeInIstanbul("2026-07-21T18:00:00Z"), "21:00", "Istanbul time conversion failed");
assert.equal(normalizeMatchStatus("1H"), "LIVE", "live status mapping failed");
assert.equal(normalizeMatchStatus("PST"), "POSTPONED", "postponed status mapping failed");
assert.equal(schemaEventStatus("FT"), "https://schema.org/EventCompleted", "SportsEvent status mapping failed");
assert.equal(normalizeCompetition({ league: "UEFA Conference League" }).id, "konferans-ligi", "Conference League mapping failed");
assert.equal(normalizeCompetition({ league: "Club Friendly Games" }).id, "hazirlik-maclari", "friendly mapping failed");
assert.equal(isFriendlyCompetition("Hazırlık Maçları"), true, "friendly classification failed");
assert.equal(normalizeBroadcast({}).status, BROADCAST_STATUSES.UNVERIFIED, "unknown broadcast must stay unverified");
assert.equal(normalizeBroadcast({ broadcastStatus: "none" }).status, BROADCAST_STATUSES.NONE, "confirmed no-broadcast mapping failed");
assert.equal(normalizeBroadcast({ channel: "TRT Spor" }).status, BROADCAST_STATUSES.CONFIRMED, "broadcast channel mapping failed");

const baseMatch = {
  id: "fixture-1",
  providerId: "1001",
  league: "UEFA Conference League",
  kickoff: "2026-07-22T20:00:00+03:00",
  homeTeam: "Başakşehir",
  awayTeam: "Inter Turku",
  status: "NS",
  source: "fixture-provider",
  fetchedAt: "2026-07-22T10:00:00Z",
  lastVerifiedAt: "2026-07-22T10:00:00Z",
  staleAfter: "2026-07-23T10:00:00Z",
  dataStatus: "verified",
  needsReview: false,
  summary: "Takımlar, tarih ve turnuva doğrulandı."
};
const normalized = normalizeMatchRecord(baseMatch);
assert.equal(normalized.kickoffAtUtc, "2026-07-22T17:00:00.000Z", "kickoff must be stored as UTC");
assert.equal(normalized.time, "20:00", "kickoff must render in Istanbul time");
assert.equal(normalized.status, "SCHEDULED", "scheduled status mapping failed");
assert.equal(matchSlug(normalized), "basaksehir-inter-turku-2026-07-22", "stable match slug failed");
assert.ok(contentQualityScore(normalized) >= 70, "complete match quality score is too low");
assert.equal(isIndexableMatch(normalized), true, "complete verified match must be indexable");

const incomplete = normalizeMatchRecord({ homeTeam: "A", awayTeam: "B", league: "Bilinmeyen Lig" });
assert.equal(isIndexableMatch(incomplete), false, "incomplete match must not be indexable");

const deduped = dedupeMatches([
  { ...baseMatch, lastVerifiedAt: "2026-07-22T09:00:00Z", summary: "Eski" },
  { ...baseMatch, lastVerifiedAt: "2026-07-22T11:00:00Z", summary: "Yeni" }
]);
assert.equal(deduped.length, 1, "provider duplicate was not removed");
assert.equal(deduped[0].summary, "Yeni", "latest verified duplicate must win");

const crossProviderDuplicate = dedupeMatches([
  { ...baseMatch, providerId: "1001", source: "provider-a", lastVerifiedAt: "2026-07-22T10:00:00Z" },
  { ...baseMatch, providerId: "other-55", source: "provider-b", lastVerifiedAt: "2026-07-22T11:00:00Z" }
]);
assert.equal(crossProviderDuplicate.length, 1, "canonical fixture duplicate across providers was not removed");
assert.equal(crossProviderDuplicate[0].source, "provider-b", "latest verified cross-provider fixture must win");

const fixtureProvider = createMatchDataProvider({
  name: "fixture-provider",
  source: "Test fixture",
  async fetchCompetitions() { return []; },
  async fetchMatchesByDate() { return [baseMatch, { ...baseMatch }]; },
  async fetchLiveMatches() { return []; },
  async fetchMatchDetails() { return baseMatch; },
  async fetchBroadcasts() { return []; }
});

const firstSync = await synchronizeMatchDate({
  provider: fixtureProvider,
  date: "2026-07-22",
  existing: [],
  now: "2026-07-22T12:00:00Z"
});
assert.equal(firstSync.report.received, 2, "sync report received count mismatch");
assert.equal(firstSync.report.accepted, 1, "sync must deduplicate provider rows");
assert.equal(firstSync.records.length, 1, "sync stored duplicate match");

const secondSync = await synchronizeMatchDate({
  provider: fixtureProvider,
  date: "2026-07-22",
  existing: firstSync.records,
  now: "2026-07-22T12:05:00Z"
});
assert.equal(secondSync.records.length, 1, "idempotent sync created a duplicate");

const emptyProvider = createMatchDataProvider({
  name: "fixture-provider",
  source: "Test fixture",
  async fetchCompetitions() { return []; },
  async fetchMatchesByDate() { return []; },
  async fetchLiveMatches() { return []; },
  async fetchMatchDetails() { return null; },
  async fetchBroadcasts() { return []; }
});
const clearedDateSync = await synchronizeMatchDate({
  provider: emptyProvider,
  date: "2026-07-22",
  existing: firstSync.records,
  now: "2026-07-22T12:10:00Z"
});
assert.equal(clearedDateSync.records.length, 0, "withdrawn fixtures must not linger in the date snapshot");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "data", "generated-match-pages.json"), "utf8"));
assert.ok(manifest.dailyPages.includes(manifest.today), "today's permanent daily URL was not generated");
for (const item of manifest.matches) {
  const html = fs.readFileSync(path.join(root, "mac", item.slug, "index.html"), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/mac\//, "match canonical missing");
  assert.ok(html.includes('"@type":"SportsEvent"'), "SportsEvent JSON-LD missing");
  assert.ok(html.includes('class="breadcrumb"'), "visible breadcrumb missing");
  assert.ok(html.includes("data-persistent-match-score"), "persistent match live score hook missing");
}

const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
assert.ok(appJs.includes('"konferans-ligi"'), "Conference League client filter missing");
assert.ok(appJs.includes('"hazirlik-maclari"'), "friendly match client filter missing");
assert.ok(appJs.includes("initPersistentMatchRefresh"), "persistent match refresh missing");
assert.ok(appJs.includes("usesMockSource"), "mock provider state classification missing");
assert.ok(appJs.includes("Maç verisine şu anda ulaşılamıyor"), "provider unavailable UI state missing");
assert.ok(appJs.includes("Maç programı henüz güncelleniyor"), "unsynced UI state missing");

console.log("Match platform tests passed");
