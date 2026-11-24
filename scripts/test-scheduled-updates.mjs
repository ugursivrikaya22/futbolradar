import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { mergeCalendarMatches, selectDetailTargets, datesForTarget, detailIncomplete, backfillDates, synchronizeLiveFixtures } from "./sync-live-fixtures.mjs";
import { providerQueryPolicy } from "./sync-fixture-predictions.mjs";
import { mergeStandings } from "./sync-standings.mjs";
import { mergeSquadStatuses } from "./sync-squad-statuses.mjs";
import { mergeNewsItems, parseRss, toTickerItem } from "./sync-football-news.mjs";
import { dedupeKey, sourceSteps, fullMaintenanceSteps, transformSteps, nonRetryableProviderCode } from "./run-scheduled-update.mjs";
import { POSTPROCESS_CHAIN } from "./lib/postprocessChain.mjs";

const root = process.cwd();
const predictionPolicyNow = new Date("2026-10-05T00:00:00Z");
assert.deepEqual(providerQueryPolicy("2026-10-09T00:00:00Z", predictionPolicyNow), {
  hoursUntilKickoff: 96, predictions: false, odds: false
}, "96 saat uzaktaki maç yalnızca yerel modelle hazırlanmalı");
assert.deepEqual(providerQueryPolicy("2026-10-08T00:00:00Z", predictionPolicyNow), {
  hoursUntilKickoff: 72, predictions: true, odds: false
}, "T-72h provider tahmini ilk kez açılmalı");
assert.deepEqual(providerQueryPolicy("2026-10-06T00:00:00Z", predictionPolicyNow), {
  hoursUntilKickoff: 24, predictions: true, odds: true
}, "T-24h oran fallback penceresi açılmalı");

assert.equal(nonRetryableProviderCode("PROVIDER_RATE_LIMIT"), "PROVIDER_RATE_LIMIT");
assert.equal(nonRetryableProviderCode("PROVIDER_AUTH_ERROR"), "PROVIDER_AUTH_ERROR");
assert.equal(nonRetryableProviderCode("PROVIDER_PLAN_ERROR"), "PROVIDER_PLAN_ERROR");
assert.equal(nonRetryableProviderCode("PROVIDER_NETWORK_ERROR"), null,
  "geçici ağ hataları yeniden denenebilir kalmalı");
assert.equal(nonRetryableProviderCode("plain failure"), null);

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

// RATE LIMIT FALLBACK. API-Football günlük kotası bittiyse canlı fikstür
// senkronu mevcut takvimi silmemeli ve tüm pipeline'ı exception ile
// düşürmemeli. Yalnızca açık PROVIDER_RATE_LIMIT bu kontrollü yolu kullanır.
const rateLimitError = () => Object.assign(new Error("quota exhausted"), { code: "PROVIDER_RATE_LIMIT" });
const fallbackPrevious = {
  source: "TheSportsDB + API-Football",
  providers: ["thesportsdb", "api-football"],
  fetchedAt: "2026-10-04T08:00:00.000Z",
  matches: [{
    id: "galatasaray-fenerbahce-2026-10-04",
    providerId: "sportsdb-rl",
    providerIds: { theSportsDb: "sportsdb-rl" },
    homeTeam: "Galatasaray",
    awayTeam: "Fenerbahçe",
    kickoff: "2026-10-04T20:00:00+03:00",
    status: "SCHEDULED",
    source: "thesportsdb"
  }]
};
const rateLimitedProvider = {
  async getFixtures() { throw rateLimitError(); },
  async getMatchDetail() { throw new Error("detail must not be called when fixture lists are unavailable"); },
  getProviderRateLimit() { return { remaining: 0 }; }
};
const rateLimitedSync = await synchronizeLiveFixtures({
  provider: rateLimitedProvider,
  backupProvider: { getMatches: async () => [] },
  mode: "hourly",
  now: new Date("2026-10-05T01:00:00+03:00"),
  previous: fallbackPrevious
});
assert.equal(rateLimitedSync.summary.degraded, true);
assert.equal(rateLimitedSync.summary.degradedCode, "PROVIDER_RATE_LIMIT");
assert.equal(rateLimitedSync.summary.fallback, "preserve-existing-calendar");
assert.equal(rateLimitedSync.summary.checked, 0);
assert.equal(rateLimitedSync.summary.added, 0);
assert.equal(rateLimitedSync.summary.updated, 0);
assert.deepEqual(rateLimitedSync.output.matches.map(({fixturePriority, ...row}) => row), fallbackPrevious.matches,
  "rate limitte son geçerli maç verisi korunmalı; yalnızca gösterim önceliği eklenebilir");

// BOŞ DÖKÜM ALANI DEPODAKİ GERÇEK VERİYİ SİLMEMELİ. `/fixtures?date=` yanıtı
// olay taşımadığı için sağlayıcı satırı `events: []` ile geliyor; bu boş dizi
// birleşmeye sızarsa bitmiş maçın olay akışı her saat başı siliniyordu.
const preserved = mergeCalendarMatches(calendarMerge.matches, [{
  match: {
    id: "9001", providerId: "9001", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe",
    kickoff: "2026-08-08T20:00:00+03:00", league: "Süper Lig", status: "FINISHED",
    providerStatus: "FT", score: { home: 2, away: 1 },
    events: [], lineups: [], statistics: [], players: []
  },
  detail: null
}]);
assert.equal(preserved.matches[0].events.length, 1, "boş olay dizisi mevcut olay akışını silmemeli");
assert.equal(preserved.matches[0].lineups.length, 1, "boş dizilişler mevcut dizilişi silmemeli");

// Dolu bir döküm elbette yazılabilmeli.
const replaced = mergeCalendarMatches(calendarMerge.matches, [{
  match: {
    id: "9001", providerId: "9001", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe",
    kickoff: "2026-08-08T20:00:00+03:00", league: "Süper Lig", status: "FINISHED",
    providerStatus: "FT", score: { home: 2, away: 1 }
  },
  detail: { events: [{ type: "Goal", minute: 61 }, { type: "Card", minute: 70 }] }
}]);
assert.equal(replaced.matches[0].events.length, 2, "gerçek döküm geldiğinde yazılmalı");

// `--match` orkestratörden alt betiğe geçmeli: tek bir maçın eksik dökümünü
// elle tamamlayabilmenin tek yolu bu (geri doldurum sırası koşu başına bir
// maç ilerliyor). Bayrak verilmediğinde komut satırı birebir eskisi gibi.
const zorlanan = sourceSteps("hourly", true, "trabzonspor-galatasaray-2026-09-19")
  .find((step) => step.id === "live-fixtures");
assert.ok(zorlanan.args.includes("--match=trabzonspor-galatasaray-2026-09-19"));
const zorlanmayan = sourceSteps("hourly", true).find((step) => step.id === "live-fixtures");
assert.ok(!zorlanmayan.args.some((arg) => String(arg).startsWith("--match=")));

// BİRİKMİŞ EKSİK DÖKÜM GERÇEKTEN SIRAYA GİRMELİ.
//
// Pencereyi genişletmek tek başına yetmiyordu: saatlik koşu sağlayıcıdan
// yalnızca dünü ve bugünü istiyor, daha eski maç listeye hiç girmiyordu.
// Ölçüldü (21 Eylül): 420 bitmiş maçın 403'ünde olay yoktu, 251'i pencere
// dışındaydı. backfillDates o günleri getirilen listeye ekliyor.
const backfillNow = Date.parse("2026-09-21T10:00:00Z");
const backfillTakvim = [
  // Dökümü eksik, üç günlük: sıraya girmeli.
  { id: "eski-eksik", homeTeam: "A", awayTeam: "B", kickoff: "2026-09-18T18:00:00Z", status: "FINISHED", events: [] },
  // Dökümü tam: bir daha hiç sorulmamalı.
  { id: "eski-tam", homeTeam: "C", awayTeam: "D", kickoff: "2026-09-17T18:00:00Z", status: "FINISHED",
    events: [{ type: "Goal" }], lineups: [{}, {}], statistics: [{}], players: [{}] },
  // Pencereden eski: sıra sonsuza kadar açık kalmasın.
  { id: "cok-eski", homeTeam: "E", awayTeam: "F", kickoff: "2026-09-01T18:00:00Z", status: "FINISHED", events: [] },
  // Dün/bugün zaten getiriliyor, tekrar eklenmemeli.
  { id: "dun", homeTeam: "G", awayTeam: "H", kickoff: "2026-09-21T02:00:00Z", status: "FINISHED", events: [] }
];
const gunler = backfillDates(backfillTakvim, backfillNow, 5);
assert.deepEqual(gunler, ["2026-09-18"], "yalnızca dökümü eksik ve pencere içindeki eski gün istenmeli");
assert.equal(backfillDates(backfillTakvim, backfillNow, 0).length, 0, "sınır sıfırsa hiç gün eklenmemeli");

// Geri doldurum tek yuvayla sınırlı kalmamalı: bir hafta sonunda yüzlerce
// maç bitiyor, yuva başına bir maç birikmiş sırayı asla eritemiyordu.
const cokEksik = Array.from({ length: 12 }, (_, index) => ({
  id: "eksik-" + index, homeTeam: "H" + index, awayTeam: "A" + index,
  kickoff: "2026-09-19T18:00:00Z", status: "FINISHED", events: []
}));
const tazeler = Array.from({ length: 8 }, (_, index) => ({
  id: "taze-" + index, homeTeam: "T" + index, awayTeam: "Z" + index,
  kickoff: "2026-09-21T08:00:00Z", status: "FINISHED", events: []
}));
const depo = new Map([...cokEksik, ...tazeler].map((row) => [row.id, row]));
const secim = selectDetailTargets([...tazeler, ...cokEksik], {
  nowMs: backfillNow, limit: 8, storedFor: (match) => depo.get(match.id) || null,
  retryWindowMs: 7 * 24 * 60 * 60 * 1000
});
assert.equal(secim.length, 8);
assert.equal(secim.filter((match) => match.id.startsWith("eksik-")).length, 5,
  "koşu başına beş yuva geri doldurmaya ayrılmalı");
assert.equal(secim.filter((match) => match.id.startsWith("taze-")).length, 3,
  "kalan yuvalar günün maçlarında kalmalı");

// TOPLU DOLDURMA. Rutin yuva sayısı biriken arşivi eritmiyor: 21 Eylül
// ölçümünde 421 bitmiş maçın 402'si olaysızdı ve koşu başına birkaç maç
// ilerlemek aylar alırdı. `--backfill=<n>` yuvayı ve döküm bütçesini tek
// seferlik büyütür; bu denetim bütçe büyüdüğünde gerçekten eski maçların
// seçildiğini ölçüyor.
const topluSecim = selectDetailTargets([...tazeler, ...cokEksik], {
  nowMs: backfillNow, limit: 20, backfillSlots: 12,
  storedFor: (match) => depo.get(match.id) || null,
  retryWindowMs: 7 * 24 * 60 * 60 * 1000
});
assert.equal(topluSecim.filter((match) => match.id.startsWith("eksik-")).length, 12,
  "toplu doldurmada yuva sayısı kadar eski maç seçilmeli");
assert.equal(topluSecim.filter((match) => match.id.startsWith("taze-")).length, 8,
  "toplu doldurma günün maçlarını listeden düşürmemeli");

const targetNow = Date.parse("2026-08-08T18:30:00Z");
const targets = selectDetailTargets([
  { id: "eu", homeTeam: "Liverpool", awayTeam: "Arsenal", kickoff: "2026-08-08T18:00:00Z", status: "LIVE" },
  { id: "tr", homeTeam: "Fenerbahçe", awayTeam: "Beşiktaş", kickoff: "2026-08-08T18:00:00Z", status: "LIVE" },
  { id: "far", homeTeam: "Galatasaray", awayTeam: "Konyaspor", kickoff: "2026-08-09T18:00:00Z", status: "SCHEDULED" }
], { nowMs: targetNow, limit: 5 });
assert.deepEqual(targets.map((item) => item.id), ["tr", "eu"]);

// YAŞ PENCERESİ DIŞINDA KALAN MAÇIN DÖKÜMÜ HÂLÂ İSTENEBİLMELİ. Bitmiş maçın
// dökümü normalde ilk düdükten sonraki 8 saat içinde isteniyor; koşucular
// saatlerce düştüğünde maç o pencerenin dışına düşüyor ve olay akışı,
// istatistik ve kadro BİR DAHA HİÇ sorulmuyordu (19 Eylül Trabzonspor-
// Galatasaray). --match verilen maç yaşına bakılmaksızın listenin başına
// alınır; kimlik ya da sağlayıcı kimliği üzerinden eşleşir.
const agedOut = [
  { id: "ts-gs", providerId: "1584420", homeTeam: "Trabzonspor", awayTeam: "Galatasaray", kickoff: "2026-09-19T17:00:00Z", status: "FINISHED", league: "Süper Lig" },
  { id: "fresh", homeTeam: "Samsunspor", awayTeam: "Rizespor", kickoff: "2026-09-20T06:00:00Z", status: "FINISHED", league: "Süper Lig" }
];
const agedNow = Date.parse("2026-09-20T09:30:00Z");
// EKSİK DÖKÜM İKİNCİ ŞANS ALIR, TAM DÖKÜM ALMAZ.
//
// 8 saatlik pencere kotayı koruyordu ama tek denemeyi nihai yapıyordu: o
// pencerede sağlayıcının olay çağrısı düşerse (getMatchDetail her alanı
// `.catch(() => [])` ile yutuyor) maç sonsuza dek olaysız kalıyordu.
// Ölçüldü: 383 bitmiş maçın 381'inde olay akışı boştu.
const tam = { events: [{}], lineups: [{}], statistics: [{}], players: [{}] };
const olaysiz = { events: [], lineups: [{}], statistics: [{}], players: [{}] };

assert.equal(detailIncomplete(olaysiz), true, "olay akışı boşsa döküm eksiktir");
assert.equal(detailIncomplete(tam), false, "dört alan da doluysa döküm tamdır");
assert.equal(detailIncomplete(null), true, "depoda kayıt yoksa döküm eksiktir");

// Yaş penceresinin dışında (16,5 saat), depoda olay akışı boş → yeniden sorulur.
assert.deepEqual(
  selectDetailTargets(agedOut, {
    nowMs: agedNow,
    limit: 5,
    storedFor: (match) => (match.id === "ts-gs" ? olaysiz : tam)
  }).map((item) => item.id),
  ["fresh", "ts-gs"],
  "dökümü eksik, penceresi geçmiş maç yeniden sorulur — ama yeni bitmiş maçtan SONRA"
);

// Aynı maçın dökümü tamsa bir daha hiç sorulmaz: kotayı koruyan asıl kural.
assert.deepEqual(
  selectDetailTargets(agedOut, { nowMs: agedNow, limit: 5, storedFor: () => tam }).map((item) => item.id),
  ["fresh"],
  "dökümü tam olan maç yaş penceresi dışında yeniden sorulmaz"
);

// Pencere de sınırsız değil: getirilen gün aralığından eski maç seçilmez.
assert.deepEqual(
  selectDetailTargets(agedOut, {
    nowMs: agedNow,
    limit: 5,
    retryWindowMs: 10 * 60 * 60 * 1000,
    storedFor: () => olaysiz
  }).map((item) => item.id),
  ["fresh"],
  "yeniden deneme penceresinden de eski maç seçilmez"
);

// Depo bilgisi verilmezse davranış ESKİSİ GİBİ: yalnızca 8 saatlik pencere.
assert.deepEqual(
  selectDetailTargets(agedOut, { nowMs: agedNow, limit: 5 }).map((item) => item.id),
  ["fresh"],
  "storedFor verilmediğinde eski davranış korunur"
);

assert.deepEqual(
  selectDetailTargets(agedOut, { nowMs: agedNow, limit: 5 }).map((item) => item.id),
  ["fresh"],
  "8 saati geçen bitmiş maç varsayılanda döküm istemez"
);
assert.deepEqual(
  selectDetailTargets(agedOut, { nowMs: agedNow, limit: 5, match: "ts-gs" }).map((item) => item.id),
  ["ts-gs", "fresh"],
  "--match verilen maç yaş penceresini deler ve listenin başına geçer"
);
assert.deepEqual(
  selectDetailTargets(agedOut, { nowMs: agedNow, limit: 5, match: "1584420" }).map((item) => item.id),
  ["ts-gs", "fresh"],
  "--match sağlayıcı kimliğiyle de eşleşir"
);

// GERÇEK SAĞLAYICI SATIRINDA TAKVİM KİMLİĞİ YOK. selectDetailTargets'e gelen
// satırlar API-Football'un ham çıktısı: id ve providerId sayısal fikstür
// kimliği, slug yok. İş akışının verdiği kimlik ise takvimdeki
// takım-takım-tarih biçimi. Eşleşme bu biçimi de tanımazsa bayrak sessizce
// etkisiz kalır.
const providerShaped = [
  { id: "1584420", providerId: "1584420", homeTeam: "Trabzonspor", awayTeam: "Galatasaray", kickoff: "2026-09-19T17:00:00Z", status: "FINISHED", league: "Süper Lig" },
  { id: "1584421", providerId: "1584421", homeTeam: "Samsunspor", awayTeam: "Rizespor", kickoff: "2026-09-20T06:00:00Z", status: "FINISHED", league: "Süper Lig" }
];
assert.deepEqual(
  selectDetailTargets(providerShaped, { nowMs: agedNow, limit: 5, match: "trabzonspor-galatasaray-2026-09-19" }).map((item) => item.id),
  ["1584420", "1584421"],
  "takvim kimliği ham sağlayıcı satırıyla doğal kimlik üzerinden eşleşir"
);

// YAŞ FİLTRESİNİ DELMEK TEK BAŞINA YETMEZ: saatlik mod yalnızca dünü ve
// bugünü soruyor, hedef maç o günlerin dışındaysa listeye hiç girmiyor.
const calendar = { matches: [
  { id: "trabzonspor-galatasaray-2026-09-19", providerId: "1584420", kickoff: "2026-09-19T20:00:00+03:00" }
] };
assert.deepEqual(datesForTarget(calendar, "trabzonspor-galatasaray-2026-09-19"), ["2026-09-19"]);
assert.deepEqual(datesForTarget(calendar, "1584420"), ["2026-09-19"]);
assert.deepEqual(datesForTarget(calendar, "bilinmeyen"), [], "tanınmayan kimlik getirme davranışını değiştirmez");
assert.deepEqual(datesForTarget(calendar, null), [], "kimlik yoksa ek gün istenmez");

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

// Season-wide provider rows: only each team's latest fixture counts, and a
// team whose latest provider fixture is too old shows no absences.
const seasonRows = [
  { player: { id: 11, name: "Old Injury", type: "Missing Fixture", reason: "Muscle Injury" }, team: { id: 645, name: "Galatasaray" }, fixture: { id: 1, date: "2026-09-19T17:00:00+00:00" }, league: { id: 203 } },
  { player: { id: 12, name: "Current Ban", type: "Missing Fixture", reason: "Red Card" }, team: { id: 645, name: "Galatasaray" }, fixture: { id: 2, date: "2026-10-09T17:00:00+00:00" }, league: { id: 203 } },
  { player: { id: 13, name: "Stale Team", type: "Missing Fixture", reason: "Knee Injury" }, team: { id: 99, name: "Stale FC" }, fixture: { id: 3, date: "2026-08-20T17:00:00+00:00" }, league: { id: 203 } }
];
const seasonMerge = mergeSquadStatuses([
  { id: "old", providerId: "11", name: "Old Injury", currentTeam: "Galatasaray", availabilityStatus: "injured", availabilitySource: "api-football" }
], { teams: [] }, seasonRows, { nowIso: "2026-10-13T05:00:00Z" });
assert.equal(seasonMerge.players[0].availabilityStatus, undefined);
assert.equal(seasonMerge.status.teams.length, 1);
assert.deepEqual(seasonMerge.status.teams[0].absences.map((a) => a.playerName), ["Current Ban"]);
assert.equal(seasonMerge.status.teams[0].absences[0].fixtureDate, "2026-10-09T17:00:00+00:00");

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
assert.match(workflow, /cron: "0 2 \* \* \*"/);
// Saatlik nöbet 20.09.2026'da İKİYE AYRILDI: gündüz saatlik, gece iki saatte
// bir. Gerekçe ölçümdü — koşu ~13 dakika sürüyor, depo private, yani gecenin
// altı saatinde neredeyse hiçbir şey değişmezken saatlik tazeleme doğrudan
// faturaya yazılıyordu. Kapsam daralmadı: gündüzün tamamı hâlâ saatlik.
assert.match(workflow, /cron: "7 4-21 \* \* \*"/);
assert.match(workflow, /cron: "7 0,22 \* \* \*"/);
// İki kısa ifade de 02:00 UTC'yi DIŞARIDA bırakıyor (4-21 ve 0,22): orası
// tam tazelemenin saati, iki iş aynı dosyalara yazmak için sıraya giremez.
// Saatleri tek tek çözüp doğruluyoruz ki ilerideki bir düzenleme 2'yi sessizce
// geri sokamasın.
{
  const hoursOf = (expr) =>
    expr.split(",").flatMap((part) => {
      const [from, to] = part.split("-").map(Number);
      return Number.isInteger(to) ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : [from];
    });
  const shortRunHours = [...hoursOf("4-21"), ...hoursOf("0,22")];
  assert.ok(!shortRunHours.includes(2), "kısa koşu 02:00 UTC'ye girmemeli — tam tazeleme orada");
  assert.equal(new Set(shortRunHours).size, shortRunHours.length, "aynı saat iki kez tetiklenmemeli");
}
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
// Koşu türü artık "Plan" adımında, kalıcı defter ve gerçek saatten karara
// bağlanıyor (scripts/plan-scheduled-update.mjs → services/operationsPolicy.js).
// İş akışı yalnızca tetik bilgisini (SCHEDULE) iletir; günlük tetik tanımı
// politika dosyasında tek yerde durur.
assert.match(workflow, /id: plan[\s\S]*SCHEDULE: \$\{\{ github\.event\.schedule \}\}/);
assert.match(fs.readFileSync(path.join(root, "services", "operationsPolicy.js"), "utf8"), /schedule==='0 2 \* \* \*'/);

const orchestrator = fs.readFileSync(path.join(root, "scripts", "run-scheduled-update.mjs"), "utf8");
assert.match(orchestrator, /nodeStep\("render-news-pages", "generate-news-pages\.mjs"/);
// EN core pages (live scores, standings, results, today's matches) must
// render every hour alongside their TR equivalents, or EN can silently
// drift up to 24h behind until the next full build.
assert.ok(POSTPROCESS_CHAIN.some(step => step.script === "generate-en-pages.mjs"));
assert.match(orchestrator, /for \(const step of POSTPROCESS_CHAIN\)/);
const duplicateGuard = orchestrator.match(/if \(duplicate && !args\.force\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  const before/)?.[1];
assert.ok(duplicateGuard, "duplicate guard block must remain detectable");
assert.doesNotMatch(duplicateGuard, /writeStatus\(/, "fallback no-op must not replace the published last-success status");
assert.match(duplicateGuard, /appendGithubSummary\(record\)/);

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
assert.ok(vercel.headers.some((entry) => entry.source === "/data/update-status.json" && entry.headers.some((header) => header.value.includes("no-store"))));
const generalDataHeaderIndex = vercel.headers.findIndex((entry) => entry.source === "/data/:path*");
const updateStatusHeaderIndex = vercel.headers.findIndex((entry) => entry.source === "/data/update-status.json");
assert.ok(generalDataHeaderIndex < updateStatusHeaderIndex, "specific update status cache policy must override the general data policy");

const adminGenerator = fs.readFileSync(path.join(root, "scripts", "generate-update-admin.mjs"), "utf8");
assert.match(adminGenerator, /data-update-monitor/);
assert.match(adminGenerator, /data\/update-status\.json/);
assert.match(adminGenerator, /Kaynak sorunu/);

// ── HAT GERÇEKTEN VAR OLAN BETİKLERİ ÇAĞIRIYOR MU ───────────────────────
//
// #274 bu dosyayı eski bir sürüme döndürünce iki şey birden oldu: saatlik
// tahmin adımı düştü ve silinmiş bir betiğe (`sync-match-predictions.mjs`)
// yapılan çağrı geri geldi. İkisi de üretimde sessiz kaldı — biri hiç
// tazelenmeyen tahmin, diğeri her gün ENOENT ile düşen bir adım olarak.
// Her ikisi de burada, koşu beklemeden yakalanır.
const pipelineSteps = [
  ...sourceSteps("hourly", true),
  ...sourceSteps("full", true),
  ...sourceSteps("full", false),
  ...fullMaintenanceSteps(true),
  ...transformSteps("full", true, true),
  ...transformSteps("hourly", true, true)
];

for (const step of pipelineSteps) {
  const script = step.args[step.args.length - 1].startsWith("--")
    ? step.args.find((arg) => String(arg).endsWith(".mjs"))
    : step.args[0];
  assert.ok(script, `adımın betiği okunamadı: ${step.id}`);
  assert.ok(
    fs.existsSync(script),
    `${step.id} adımı diskte olmayan bir betiğe işaret ediyor: ${script} — ` +
    "bu koşu üretimde ENOENT ile düşer"
  );
}

const predictionSteps = ["hourly", "full"].map((type) =>
  sourceSteps(type, false).find((step) => step.id === "fixture-predictions"));
assert.ok(predictionSteps[0], "tahmin adımı SAATLİK koşuda olmalı: tazeleme basamakları (T-6s, T-90dk) günlük koşuyla yakalanmaz");
assert.ok(predictionSteps[1], "tahmin adımı günlük koşuda da olmalı");
assert.ok(
  predictionSteps.every((step) => !step.skip),
  "sağlayıcı yapılandırılmamışken bile atlanmamalı: zincirin üçüncü halkası (FutbolRadar modeli) kotadan bağımsız çalışır"
);

console.log(`hat bütünlüğü: ${pipelineSteps.length} adımın betiği diskte var; tahmin adımı saatlik ve günlük koşuda.`);

console.log("Scheduled update tests passed (cron split, dedupe, live merge, standings, absences, RSS, monitoring cache)." );
