import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { mergeCalendarMatches, selectDetailTargets } from "./sync-live-fixtures.mjs";
import { mergeStandings } from "./sync-standings.mjs";
import { mergeSquadStatuses } from "./sync-squad-statuses.mjs";
import { mergeNewsItems, parseRss, toTickerItem } from "./sync-football-news.mjs";
import { dedupeKey } from "./run-scheduled-update.mjs";

const root = process.cwd();

// Live provider data upgrades the existing fixture without duplicating it and
// preserves the original provider identity for traceability.
const calendarMerge = mergeCalendarMatches([
  {
    id: "galatasaray-fenerbahce-2026-08-08",
    providerId: "sportsdb-1",
    providerIds: { theSportsDb: "sportsdb-1" },
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    kickoff: "2026-08-08T20:00:00+03:00",
    status: "SCHEDULED",
    score: { home: null, away: null },
    source: "thesportsdb"
  }
], [{
  match: {
    id: "9001",
    providerId: "9001",
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    kickoff: "2026-08-08T20:00:00+03:00",
    league: "Süper Lig",
    status: "LIVE",
    providerStatus: "2H",
    score: { home: 2, away: 1 }
  },
  detail: { events: [{ type: "Goal", minute: 61 }], lineups: [{ team: "Galatasaray" }], analysis: { signals: [], generatedAt: "2026-08-08T19:00:00Z" } }
}]);
assert.equal(calendarMerge.matches.length, 1);
assert.equal(calendarMerge.updated, 1);
assert.equal(calendarMerge.matches[0].providerId, "9001");
assert.equal(calendarMerge.matches[0].providerIds.theSportsDb, "sportsdb-1");
assert.equal(calendarMerge.matches[0].providerIds.apiFootball, "9001");
assert.equal(calendarMerge.matches[0].status, "LIVE");
assert.deepEqual(calendarMerge.matches[0].score, { home: 2, away: 1, halftimeHome: null, halftimeAway: null });
assert.equal(calendarMerge.matches[0].events.length, 1);
const unchangedCalendar = mergeCalendarMatches(calendarMerge.matches, [{
  match: {
    id: "9001", providerId: "9001", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe",
    kickoff: "2026-08-08T20:00:00+03:00", league: "Süper Lig", status: "LIVE", providerStatus: "2H",
    score: { home: 2, away: 1 }
  },
  detail: { events: [{ type: "Goal", minute: 61 }], lineups: [{ team: "Galatasaray" }], analysis: { signals: [], generatedAt: "2026-08-08T19:01:00Z" } }
}]);
assert.equal(unchangedCalendar.updated, 0, "volatile provider timestamps must not cause hourly rewrites");

const targetNow = Date.parse("2026-08-08T18:30:00Z");
const targets = selectDetailTargets([
  { id: "eu", homeTeam: "Liverpool", awayTeam: "Arsenal", kickoff: "2026-08-08T18:00:00Z", status: "LIVE" },
  { id: "tr", homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: "2026-08-08T18:00:00Z", status: "LIVE" },
  { id: "far", homeTeam: "Galatasaray", awayTeam: "Konyaspor", kickoff: "2026-08-09T18:00:00Z", status: "SCHEDULED" }
], { nowMs: targetNow, limit: 5 });
assert.deepEqual(targets.map((item) => item.id), ["tr", "eu"]);

// Standings update only changed fields; a later check with identical football
// data does not rewrite timestamps or records.
const teams = [{ id: "galatasaray", providerId: "645", name: "Galatasaray", rank: 2, played: 1, points: 3, standingsStatus: "live" }];
const standingRows = [{ providerId: "645", team: "Galatasaray", rank: 1, played: 2, won: 2, drawn: 0, lost: 0, goalsFor: 5, goalsAgainst: 1, goalDifference: 4, points: 6, average: 4, form: ["W", "W"] }];
const firstStandings = mergeStandings(teams, standingRows, { nowIso: "2026-08-08T02:00:00Z", season: "2026/27" });
assert.equal(firstStandings.updated, 1);
assert.equal(firstStandings.teams[0].points, 6);
assert.deepEqual(firstStandings.teams[0].form.map((item) => item.result), ["win", "win"]);
const secondStandings = mergeStandings(firstStandings.teams, standingRows, { nowIso: "2026-08-08T03:00:00Z", season: "2026/27" });
assert.equal(secondStandings.updated, 0);
assert.equal(secondStandings.teams[0].lastStandingsSyncedAt, "2026-08-08T02:00:00Z");

// Provider absences update provider-owned fields while a manually edited
// availability decision remains authoritative.
const playerMerge = mergeSquadStatuses([
  { id: "manual", providerId: "1", name: "Manual Player", currentTeam: "Galatasaray", availabilityStatus: "suspended", availabilityNote: "Editorial", availabilitySource: "manual" },
  { id: "provider", providerId: "2", name: "Provider Player", currentTeam: "Galatasaray" },
  { id: "recovered", providerId: "3", name: "Recovered Player", currentTeam: "Fenerbahçe", availabilityStatus: "injured", availabilitySource: "api-football" }
], { teams: [] }, [
  { player: { id: 1, name: "Manual Player", type: "Missing Fixture", reason: "Injury" }, team: { id: 10, name: "Galatasaray" } },
  { player: { id: 2, name: "Provider Player", type: "Questionable", reason: "Knock" }, team: { id: 10, name: "Galatasaray" } }
], { nowIso: "2026-08-08T02:00:00Z" });
assert.equal(playerMerge.players[0].availabilitySource, "manual");
assert.equal(playerMerge.players[1].availabilityStatus, "doubtful");
assert.equal(playerMerge.players[2].availabilityStatus, undefined);
assert.equal(playerMerge.status.teams[0].absenceCount, 2);
const unchangedPlayers = mergeSquadStatuses(playerMerge.players, playerMerge.status, [
  { player: { id: 1, name: "Manual Player", type: "Missing Fixture", reason: "Injury" }, team: { id: 10, name: "Galatasaray" } },
  { player: { id: 2, name: "Provider Player", type: "Questionable", reason: "Knock" }, team: { id: 10, name: "Galatasaray" } }
], { nowIso: "2026-08-08T03:00:00Z" });
assert.equal(unchangedPlayers.playersUpdated, 0);
assert.equal(unchangedPlayers.statusChanged, false);

const rss = `<?xml version="1.0"?><rss><channel><item>
  <title><![CDATA[Galatasaray yeni sezon hazırlıklarını sürdürdü - Galatasaray]]></title>
  <link>https://news.google.com/rss/articles/example</link>
  <guid>official-1</guid><pubDate>Sat, 08 Aug 2026 10:00:00 GMT</pubDate>
  <source url="https://www.galatasaray.org">Galatasaray</source>
</item></channel></rss>`;
const parsed = parseRss(rss, { id: "galatasaray", team: "Galatasaray", priority: 1 });
assert.equal(parsed.length, 1);
const tickerItem = toTickerItem(parsed[0]);
assert.equal(tickerItem.confidence, "confirmed");
assert.equal(tickerItem.category, "official");
const mergedNews = mergeNewsItems({ items: [{ id: "editorial", text: "Manual", timestamp: "2026-08-08T09:00:00Z" }] }, [tickerItem], { nowMs: Date.parse("2026-08-08T12:00:00Z") });
assert.equal(mergedNews.changed, true);
assert.equal(mergedNews.items.some((item) => item.id === "editorial"), true);
assert.equal(mergedNews.items.some((item) => item.id === tickerItem.id), true);
assert.equal(mergeNewsItems({ items: mergedNews.items }, [tickerItem], { nowMs: Date.parse("2026-08-08T12:30:00Z") }).changed, false);

assert.equal(dedupeKey("full", new Date("2026-08-08T02:00:00Z")), "full:2026-08-08");
assert.equal(dedupeKey("hourly", new Date("2026-08-08T21:00:00Z")), "hourly:2026-08-09T00");

const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "match-analysis.yml"), "utf8");

// ZAMANLAMA: GÜNLÜK TAM + SAATLİK KISA, TEK NÖBET.
//
// Dakika-20 YEDEK tetikleri 24.08.2026'da bilinçli olarak kaldırıldı
// ("drop minute-20 fallback crons to cut Actions minutes usage"); test o
// gün güncellenmediği için, iş akışı doğru olduğu hâlde kırmızı kalmıştı.
// Yedeği güvenli kılan şey `dedupeKey`: aynı pencerede ikinci koşu zaten
// atlanıyor. Geri eklenecekse Actions dakikası maliyeti bilinçli kabul
// edilmeli — o yüzden burada varlığı değil, YOKLUĞU değil, YALNIZCA
// ÇALIŞAN İKİ TETİĞİN DOĞRULUĞU şart koşuluyor.
// Dakika 7 KASITLI: GitHub'ın kendi belgelerine göre `schedule` olayı en
// yoğun kuyruğu saat başında yaşıyor; `:00`'a sabitlenmiş koşular bu depoda
// 4-8 saat gecikmeli başlıyordu (03.09.2026'da tam koşu hiç tetiklenmedi).
// Dakikayı kaydırmak GitHub'ın önerdiği düzeltme — bkz. docs/scheduled-updates.md.
assert.match(workflow, /cron: "7 2 \* \* \*"/);
assert.match(workflow, /cron: "7 0-1,3-23 \* \* \*"/);
// Tam koşu ile saatlik koşu ÇAKIŞMAZ: saatlik ifade 02:00'ı dışarıda
// bırakıyor. Aksi hâlde iki iş aynı dosyalara yazmak için sıraya girerdi.
// Yalnızca dakika 7 değil, HERHANGİ bir dakikada saatte-bir joker de
// yasak: aksi hâlde biri ileride "7"yi de unutup `0 * * * *` (veya başka
// bir dakika) eklerse aynı çakışma sessizce geri döner.
assert.doesNotMatch(workflow, /cron: "\d+ \* \* \* \*"/);
// Beş dakikada bir koşu hiçbir koşulda kabul edilmiyor: sağlayıcı kotası ve
// Actions dakikası bu sıklığı kaldırmıyor.
assert.doesNotMatch(workflow, /\*\/5/);
assert.match(workflow, /group: futbolradar-production-update/);
assert.match(workflow, /FUTBOLRADAR_AUTOMATION_TOKEN/);
// Koşu türü SCHEDULE değişkeninden okunuyor ve tam koşuyu yalnızca günlük
// tetik seçiyor; geri kalan her tetik saatlik koşu demek.
assert.match(workflow, /SCHEDULE.*"7 2 \* \* \*"/s);

const orchestrator = fs.readFileSync(path.join(root, "scripts", "run-scheduled-update.mjs"), "utf8");
assert.match(orchestrator, /nodeStep\("render-news-pages", "generate-news-pages\.mjs"/);
// EN core pages (live scores, standings, results, today's matches) must
// render every hour alongside their TR equivalents, or EN can silently
// drift up to 24h behind until the next full build.
assert.match(orchestrator, /nodeStep\("render-en-pages", "generate-en-pages\.mjs"/);
const hourlyPlayerBuild = orchestrator.match(/if \(diff\.playersUpdated\) \{([\s\S]*?)\n  \}/)?.[1];
assert.ok(hourlyPlayerBuild, "hourly player rebuild block must remain detectable");
assert.match(hourlyPlayerBuild, /nodeStep\("render-player-pages", "generate-player-profile-pages\.mjs"/);
assert.match(hourlyPlayerBuild, /nodeStep\("render-player-comparisons", "generate-player-comparison-pages\.mjs"/);
assert.match(hourlyPlayerBuild, /nodeStep\("render-en-player-pages", "generate-en-player-pages\.mjs"/);
assert.match(hourlyPlayerBuild, /nodeStep\("prerender-player-content", "prerender-player-content\.mjs"/);
const duplicateGuard = orchestrator.match(/if \(duplicate && !args\.force\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  const before/)?.[1];
assert.ok(duplicateGuard, "duplicate guard block must remain detectable");
assert.doesNotMatch(duplicateGuard, /writeStatus\(/, "fallback no-op must not replace the published last-success status");
assert.match(duplicateGuard, /appendGithubSummary\(record\)/);
const qaBlock = orchestrator.match(/const qa = await runStep\(([\s\S]*?)\n      if \(qa\.status === "failed"\) \{/);
assert.ok(qaBlock, "QA step block must remain detectable");
assert.match(qaBlock[1], /required: false/, "QA must not block publication of otherwise valid data");
assert.match(orchestrator, /status: criticalFailure \? "failed" : \(optionalSourceErrors\.length \|\| skippedSources\.length \|\| qaFailure\) \? "partial" : "success"/);

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
assert.ok(vercel.headers.some((entry) => entry.source === "/data/update-status.json" && entry.headers.some((header) => header.value.includes("no-store"))));
const generalDataHeaderIndex = vercel.headers.findIndex((entry) => entry.source === "/data/:path*");
const updateStatusHeaderIndex = vercel.headers.findIndex((entry) => entry.source === "/data/update-status.json");
assert.ok(generalDataHeaderIndex < updateStatusHeaderIndex, "specific update status cache policy must override the general data policy");

const adminGenerator = fs.readFileSync(path.join(root, "scripts", "generate-update-admin.mjs"), "utf8");
assert.match(adminGenerator, /data-update-monitor/);
assert.match(adminGenerator, /data\/update-status\.json/);
assert.match(adminGenerator, /Kaynak sorunu/);

console.log("Scheduled update tests passed (cron split, dedupe, live merge, standings, absences, RSS, monitoring cache)." );
