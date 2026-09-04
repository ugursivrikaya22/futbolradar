import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { buildMetrics, metricMap } = require("../services/playerMetricsService.js");
const { computePlayerScore } = require("../services/playerScoreService.js");
const { buildFormTrend, buildTransferRumors } = require("../services/playerInsightService.js");
const { buildPlayerProfile, normalizeMatchEntry } = require("../services/playerProfileService.js");
const { getPlayers } = require("../services/playerService.js");
const { enrichPlayerRating } = require("../services/ratingService.js");
const apiFootball = require("../services/providers/apiFootballProvider.js");
const view = require("../player-profile.js");

const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
const players = getPlayers(rawPlayers, { atDate: "2026-07-25" }).map((player) => enrichPlayerRating(player));

/* -------------------------------------------------------------------- */
/* Metrik katmanı                                                        */
/* -------------------------------------------------------------------- */

const metricSample = buildMetrics({
  position: "Santrfor",
  stats: { appearances: 20, minutes: 1800, goals: 12, assists: 4, keyPasses: 30 },
  shotsPerGame: 3
}, { positionGroup: "forward" });
const metricLookup = metricMap(metricSample);

assert.equal(metricLookup.get("goals").per90, 0.6, "per90 must normalise to 90 minutes");
assert.equal(metricLookup.get("shots").value, 60, "maç başına gelen metrik sezon toplamına çevrilmeli");
assert.equal(metricLookup.get("xg").available, false, "veri yoksa metrik available:false olmalı");
assert.equal(metricLookup.get("xg").value, null, "eksik metrik sıfırla doldurulmamalı");

const shortMinutes = metricMap(buildMetrics({
  position: "Santrfor",
  stats: { appearances: 1, minutes: 45, goals: 1 }
}, { positionGroup: "forward" }));
assert.equal(shortMinutes.get("goals").per90, null, "90 dakikanın altında per90 üretilmemeli");

/* -------------------------------------------------------------------- */
/* Oyuncu skoru                                                          */
/* -------------------------------------------------------------------- */

const emptyScore = computePlayerScore({
  player: { name: "Veri Yok", ratingStatus: "pending" },
  metrics: buildMetrics({ position: "Stoper" }, { positionGroup: "defender" }),
  matchLog: [],
  positionGroup: "defender"
});
assert.equal(emptyScore.value, null, "veri yokken skor üretilmemeli");
assert.equal(emptyScore.available, false);
assert.ok(emptyScore.reason, "skor yoksa gerekçe yazılmalı");
assert.ok(emptyScore.components.every((item) => item.available === false));

const providerLog = [
  { date: "2026-05-10", rating: 7.8, minutes: 90 },
  { date: "2026-05-17", rating: 7.2, minutes: 90 },
  { date: "2026-05-24", rating: 8.4, minutes: 88 }
];
const providerScore = computePlayerScore({
  player: { name: "Test", overallRating: 60, ratingStatus: "estimated" },
  metrics: buildMetrics({
    position: "Sol kanat",
    stats: { appearances: 20, minutes: 1750, goals: 8, assists: 6, keyPasses: 40, passAccuracy: 82, dribbles: 45, duelsWon: 90, shots: 50 }
  }, { positionGroup: "winger" }),
  matchLog: providerLog,
  positionGroup: "winger"
});
assert.ok(providerScore.value > 0 && providerScore.value <= 100, "skor 0-100 aralığında olmalı");
const scoreComponents = new Map(providerScore.components.map((item) => [item.key, item]));
assert.equal(scoreComponents.get("puan").source, "provider", "sağlayıcı reytingi varsa puan bileşeni ondan gelmeli");
assert.equal(scoreComponents.get("form").available, true);
assert.equal(scoreComponents.get("istikrar").available, true);
assert.equal(providerScore.confidence.ratio, 1, "tüm bileşenler doluysa güven oranı 1 olmalı");

const partialScore = computePlayerScore({
  player: { name: "Kısmi", formRating: 70, ratingStatus: "estimated", overallRating: 72 },
  metrics: buildMetrics({ position: "Orta saha" }, { positionGroup: "midfielder" }),
  matchLog: [],
  positionGroup: "midfielder"
});
assert.ok(partialScore.confidence.ratio < 1, "eksik bileşen güven oranını düşürmeli");
assert.equal(partialScore.confidence.modelOnly, true, "yalnızca model bileşeni varsa işaretlenmeli");

/* -------------------------------------------------------------------- */
/* Form eğrisi ve trend                                                  */
/* -------------------------------------------------------------------- */

const risingTrend = buildFormTrend({}, [
  { date: "2026-05-01", rating: 6.2 },
  { date: "2026-05-08", rating: 6.6 },
  { date: "2026-05-15", rating: 7.4 },
  { date: "2026-05-22", rating: 7.9 }
]);
assert.equal(risingTrend.direction, "up");
assert.equal(risingTrend.points[0].date, "2026-05-01", "form noktaları eskiden yeniye sıralanmalı");

const fallingTrend = buildFormTrend({}, [
  { date: "2026-05-01", rating: 8.1 },
  { date: "2026-05-08", rating: 7.6 },
  { date: "2026-05-15", rating: 6.4 },
  { date: "2026-05-22", rating: 6.1 }
]);
assert.equal(fallingTrend.direction, "down");

const emptyTrend = buildFormTrend({}, []);
assert.equal(emptyTrend.available, false);
assert.equal(emptyTrend.points.length, 0);
assert.ok(emptyTrend.note);

/* -------------------------------------------------------------------- */
/* Maç kaydı normalizasyonu                                              */
/* -------------------------------------------------------------------- */

const matchEntry = normalizeMatchEntry({
  fixtureId: 42,
  date: "2026-05-24",
  opponent: "Trabzonspor",
  venue: "away",
  teamGoals: 2,
  opponentGoals: 3,
  minutes: 90,
  rating: "7.166",
  goals: 1
});
assert.equal(matchEntry.result, "loss", "skor sonucu maç kaydından türetilmeli");
assert.equal(matchEntry.scoreLabel, "2-3");
assert.equal(matchEntry.rating, 7.17, "reyting iki basamağa yuvarlanmalı");
assert.equal(matchEntry.assists, null, "gelmeyen metrik sıfır sayılmamalı");

/* -------------------------------------------------------------------- */
/* Profil sözleşmesi                                                     */
/* -------------------------------------------------------------------- */

/**
 * DOĞRULANMIŞ FİKSTÜR.
 *
 * services/cardCredibility.js kapısı gerçek sağlayıcı kimliği, kaynak
 * bağlantısı, taze doğrulama ve "verified" rating durumu ister; sayım
 * istatistikleri ise ancak gerçekten oynanmışsa yayımlanır. Profilin zengin
 * hâli yalnızca bu koşullarda üretilebilmeli.
 */
const NOW = "2026-08-28T12:00:00Z";
const verifiedRecord = {
  id: "test-verified",
  name: "Test Oyuncu",
  currentTeam: "Test SK",
  league: "Süper Lig",
  position: "Sol kanat",
  birthDate: "1998-10-21",
  height: "180 cm",
  preferredFoot: "Sağ",
  nationality: "Türkiye",
  providerId: "49866",
  sourceUrl: "https://v3.football.api-sports.io/players?id=49866",
  lastVerifiedAt: "2026-08-20T10:00:00Z",
  lastSyncedAt: "2026-08-20T10:00:00Z",
  statsVerifiedAt: "2026-08-20T10:00:00Z",
  dataStatus: "verified",
  ratingStatus: "verified",
  rating: 82,
  overallRating: 82,
  marketValueEur: 22500000,
  contractUntil: "2029-06-30",
  shirtNumber: 7,
  stats: {
    appearances: 20,
    minutes: 1750,
    goals: 8,
    assists: 6,
    shots: 50,
    keyPasses: 40,
    passAccuracy: 82,
    dribbles: 45,
    duelsWon: 90,
    xg: 6.4,
    xa: 4.1
  }
};
const verified = getPlayers([verifiedRecord], { atDate: NOW })[0];
const verifiedProfile = buildPlayerProfile({ player: verified, players: [verified], transfers, atDate: NOW });

assert.equal(verifiedProfile.credibility.verified, true, "doğrulanmış kayıt kapıdan geçmeli");
assert.equal(verifiedProfile.identity.team.value, "Test SK");
assert.equal(verifiedProfile.identity.shirtNumber.value, 7, "forma numarası yayımlanmalı");
assert.equal(verifiedProfile.identity.contract.available, true);
assert.ok(verifiedProfile.identity.contract.remainingLabel, "sözleşme kalan süresi hesaplanmalı");
assert.equal(verifiedProfile.season.available, true, "doğrulanmış istatistik sezon bölümünü açmalı");
assert.ok(verifiedProfile.score.value > 0, "doğrulanmış kayıtta skor üretilmeli");
assert.ok(verifiedProfile.analysis.available, "veri varken analiz özeti üretilmeli");
assert.ok(verifiedProfile.analysis.summary.startsWith("Test Oyuncu"), "analiz özeti oyuncu adıyla başlamalı");
assert.equal(verifiedProfile.recent.available, false, "sağlayıcı maç kaydı yokken son maç bölümü boş olmalı");
assert.equal(verifiedProfile.recent.matches.length, 0, "maç kaydı uydurulmamalı");
assert.ok(verifiedProfile.recent.note, "boş maç kaydı için açıklama yazılmalı");
assert.equal(verifiedProfile.rumors.available, false, "doğrulanmamış söylenti üretilmemeli");

/**
 * KAPIDAN GEÇEMEYEN KAYIT.
 *
 * Kadro senkronundan gelen kayıtlarda istatistik uç noktası hiç çağrılmıyor;
 * normalizePlayer eksik alanları sıfırla dolduruyor. "0 maçta 0 dakika"
 * ölçülmüş bir iddia gibi okunur, bu yüzden hiçbir sayı yayımlanmamalı.
 */
const squadRecord = {
  ...verifiedRecord,
  id: "test-squad-sync",
  name: "Kadro Kaydı",
  ratingStatus: "estimated",
  statsVerifiedAt: null,
  stats: { appearances: 0, minutes: 0, goals: 0, assists: 0 }
};
const squadSynced = getPlayers([squadRecord], { atDate: NOW })[0];
const squadProfile = buildPlayerProfile({ player: squadSynced, players: [], transfers: [], atDate: NOW });

assert.equal(squadProfile.credibility.verified, true, "kayıt kaynak doğrulamasını geçiyor");
assert.equal(squadProfile.season.available, false, "ölçülmemiş sıfırlar sezon tablosu açmamalı");
assert.equal(squadProfile.score.available, false, "ölçülmemiş sıfırlardan skor üretilmemeli");
assert.equal(squadProfile.analysis.available, false, "ölçülmemiş sıfırlardan analiz cümlesi kurulmamalı");
assert.equal(squadProfile.identity.team.value, "Test SK", "kadro uç noktasının sağladığı alanlar yayımlanır");

const unverifiedRecord = {
  id: "test-unverified",
  name: "Doğrulanmamış Kayıt",
  currentTeam: "Test SK",
  position: "Santrfor",
  birthDate: "2000-01-01",
  height: "185 cm",
  providerId: "mock-test",
  dataStatus: "mock_needs_verification",
  ratingStatus: "estimated",
  marketValueEur: 5000000,
  stats: { appearances: 18, minutes: 1500, goals: 9 }
};
const unverified = getPlayers([unverifiedRecord], { atDate: NOW })[0];
const unverifiedProfile = buildPlayerProfile({ player: unverified, players: [], transfers: [], atDate: NOW });

assert.equal(unverifiedProfile.credibility.verified, false);
assert.ok(unverifiedProfile.credibility.reasons.length > 0, "doğrulanmama gerekçesi taşınmalı");
assert.equal(unverifiedProfile.identity.team.available, false, "doğrulanmamış kayıtta kulüp yayımlanmamalı");
assert.equal(unverifiedProfile.identity.marketValue.available, false, "doğrulanmamış kayıtta piyasa değeri yayımlanmamalı");
assert.equal(unverifiedProfile.season.available, false, "doğrulanmamış kayıtta sezon tablosu çizilmemeli");
assert.equal(unverifiedProfile.score.available, false, "doğrulanmamış kayıttan skor türetilmemeli");
assert.equal(unverifiedProfile.form.available, false);
assert.equal(unverifiedProfile.analysis.available, false);
assert.equal(unverifiedProfile.transferHistory.length, 0, "doğrulanmamış kayıtta transfer geçmişi yayımlanmamalı");
assert.equal(unverifiedProfile.identity.position.available, true, "kimlik alanları doğrulamadan bağımsız yayımlanır");
assert.equal(unverifiedProfile.identity.age.available, true);
assert.ok(unverifiedProfile.identity.team.note.includes("Doğrulanmış"), "boş durumun gerekçesi doğrulama olmalı");

const withLog = buildPlayerProfile({
  player: verified,
  players: [verified],
  transfers,
  atDate: NOW,
  recentWindow: 25,
  matchLog: Array.from({ length: 14 }, (item, index) => ({
    fixtureId: String(index),
    date: `2026-04-${String(index + 1).padStart(2, "0")}`,
    opponent: `Rakip ${index}`,
    venue: index % 2 ? "away" : "home",
    teamGoals: 2,
    opponentGoals: 1,
    minutes: 90,
    rating: 7 + (index % 3) * 0.3,
    goals: index % 2,
    assists: 0
  }))
});
assert.equal(withLog.recent.matches.length, 10, "maç penceresi en fazla 10 olmalı");
assert.equal(withLog.recent.matches[0].date, "2026-04-14", "son maç kayıtları yeniden eskiye sıralanmalı");
assert.equal(withLog.data.matchLogAvailable, true);
assert.ok(withLog.recent.totals.some((total) => total.key === "rating" && total.available));

const barePlayer = getPlayers([{
  id: "bos-kayit",
  name: "Boş Kayıt",
  currentTeam: "Test SK",
  position: "Stoper",
  ratingStatus: "pending",
  dataStatus: "pending"
}])[0];
const bareProfile = buildPlayerProfile({ player: barePlayer, players: [], transfers: [] });

assert.equal(bareProfile.score.available, false, "istatistiksiz oyuncuda skor üretilmemeli");
assert.equal(bareProfile.season.available, false);
assert.equal(bareProfile.analysis.available, false);
assert.equal(bareProfile.strengths.available, false);
assert.equal(bareProfile.weaknesses.available, false);
assert.equal(bareProfile.form.available, false);
assert.equal(bareProfile.identity.marketValue.available, false);
assert.ok(bareProfile.data.missingIdentityFields.length > 0);

const rumorBlock = buildTransferRumors({ id: "x", name: "X" }, [
  { playerName: "X", status: "rumour", toTeam: "Y", source: "Kaynak", reliability: "orta" },
  { playerName: "X", status: "confirmed", toTeam: "Z", date: "2026-01-01" }
]);
assert.equal(rumorBlock.available, true);
assert.equal(rumorBlock.items.length, 1);
assert.equal(rumorBlock.confirmed.length, 1);

/* -------------------------------------------------------------------- */
/* Görünüm katmanı                                                       */
/* -------------------------------------------------------------------- */

const html = view.renderProfileHtml(verifiedProfile, { hrefPrefix: "./", rootPrefix: "../" });
assert.ok(html.includes("Oyuncu Skoru"), "profil skoru bölümü basılmalı");
assert.ok(!html.includes("<h1>"), "profil kartı sayfanın tek H1'ini ikinci kez basmamalı");
assert.ok(html.includes('data-player-verified="true"'), "doğrulanmış profil işaretlenmeli");
assert.ok(html.includes("Sezon İstatistikleri"));
assert.ok(html.includes("Form Grafiği ve Trend"));
assert.ok(html.includes("AI Destekli Analiz Özeti"));
assert.ok(html.includes("Güçlü Yönler"));
assert.ok(html.includes("Geliştirmesi Gereken Yönler"));
assert.ok(html.includes("Benzer Oyuncular"));
assert.ok(html.includes("Aynı Mevkide Öne Çıkan Alternatifler"));
assert.ok(html.includes("Transfer Söylentileri"));
assert.ok(html.includes("player-empty-block"), "veri olmayan bölüm boş durum kartıyla basılmalı");
assert.equal(html, view.renderProfileHtml(verifiedProfile, { hrefPrefix: "./", rootPrefix: "../" }), "aynı veri aynı HTML üretmeli (prerender/hydration eşitliği)");

// Doğrulanmamış kayıtta ölçüm bölümleri HİÇ çizilmez: tek gerekçe kartı.
const unverifiedHtml = view.renderProfileHtml(unverifiedProfile, { hrefPrefix: "./" });
assert.ok(unverifiedHtml.includes('data-player-verified="false"'), "doğrulanmamış profil işaretlenmeli");
assert.ok(unverifiedHtml.includes("Veri Doğrulama Durumu"), "doğrulama durumu bölümü basılmalı");
assert.ok(unverifiedHtml.includes("sağlayıcı kimliği yer tutucu (mock)"), "doğrulanmama gerekçesi sayfada görünmeli");
assert.ok(!unverifiedHtml.includes("Sezon İstatistikleri"), "doğrulanmamış kayıtta sezon tablosu çizilmemeli");
assert.ok(!unverifiedHtml.includes("Oyuncu Skoru Kırılımı"), "doğrulanmamış kayıtta skor kırılımı çizilmemeli");
assert.ok(!unverifiedHtml.includes("Test SK"), "doğrulanmamış kayıtta kulüp adı sızmamalı");
assert.ok(unverifiedHtml.includes("Kimlik ve Kulüp"), "kimlik ızgarası her durumda çizilir");

const bareHtml = view.renderProfileHtml(bareProfile, { hrefPrefix: "./" });
assert.ok(bareHtml.includes("Yayımlanmıyor") || bareHtml.includes("Hesaplanamadı"), "skorsuz profilde boş durum gösterilmeli");

const injected = view.renderProfileHtml({
  ...bareProfile,
  name: '<img src=x onerror="alert(1)">'
}, { hrefPrefix: "./" });
assert.ok(!injected.includes("<img src=x"), "oyuncu adı HTML olarak yorumlanmamalı");
assert.ok(injected.includes("&lt;img src=x"), "kaçış uygulanmalı");

/* -------------------------------------------------------------------- */
/* Sağlayıcı normalizasyonu                                              */
/* -------------------------------------------------------------------- */

const aggregated = apiFootball.aggregateStatistics([
  {
    games: { appearences: 10, lineups: 9, minutes: 800, rating: "7.20", position: "Attacker" },
    shots: { total: 20, on: 9 },
    goals: { total: 5, assists: 2 },
    passes: { total: 300, key: 15, accuracy: 82 },
    tackles: { total: 8, interceptions: 4, blocks: 1 },
    duels: { total: 90, won: 45 },
    dribbles: { attempts: 40, success: 22 },
    cards: { yellow: 2, red: 0 }
  },
  {
    games: { appearences: 4, lineups: 3, minutes: 300, rating: "6.40" },
    shots: { total: 6, on: 2 },
    goals: { total: 1, assists: 1 },
    passes: { total: 120, key: 5, accuracy: 78 },
    tackles: { total: 3, interceptions: 1, blocks: 0 },
    duels: { total: 30, won: 12 },
    dribbles: { attempts: 12, success: 5 },
    cards: { yellow: 1, red: 0 }
  }
]);
assert.equal(aggregated.appearances, 14, "turnuva blokları toplanmalı");
assert.equal(aggregated.goals, 6);
assert.equal(aggregated.dribbles, 27);
assert.equal(aggregated.duelsWon, 57);
assert.equal(aggregated.interceptions, 5);
assert.ok(aggregated.rating > 6.9 && aggregated.rating < 7.2, "reyting dakikaya göre ağırlıklı olmalı");

const normalizedProviderPlayer = apiFootball.normalizePlayer({
  player: { id: 55, name: "Test Oyuncu", age: 24, photo: "https://media.api-sports.io/football/players/55.png", birth: { date: "2002-01-01" } },
  statistics: [{
    team: { id: 611, name: "Fenerbahçe" },
    league: { name: "Süper Lig" },
    games: { appearences: 10, minutes: 900, rating: "7.5", position: "Midfielder", number: 17 },
    goals: { total: 3, assists: 2 },
    passes: { total: 400, key: 20, accuracy: 88 },
    duels: { total: 100, won: 55 }
  }]
});
assert.equal(normalizedProviderPlayer.shirtNumber, 17, "forma numarası sağlayıcıdan okunmalı");
assert.equal(normalizedProviderPlayer.currentTeamProviderId, "611");
assert.equal(normalizedProviderPlayer.providerRating, 7.5);
assert.equal(normalizedProviderPlayer.overallRating, undefined, "0-10 reyting 0-100 rating alanına yazılmamalı");
assert.equal(normalizedProviderPlayer.marketValueEur, null, "sağlayıcıda olmayan piyasa değeri uydurulmamalı");

const fixtureStats = apiFootball.fixturePlayerStats({
  statistics: [{
    games: { minutes: 90, rating: "8.1", substitute: false, number: 10 },
    goals: { total: 1, assists: null },
    passes: { total: 55, key: 3, accuracy: 340 },
    shots: { total: 4, on: 2 },
    duels: { total: 12, won: 7 },
    dribbles: { attempts: 6, success: 4 },
    tackles: { total: 2, interceptions: 1 }
  }]
});
assert.equal(fixtureStats.started, true);
assert.equal(fixtureStats.passAccuracy, null, "yüzde olmayan pas isabeti değeri yüzde alanına yazılmamalı");
assert.equal(fixtureStats.dribbles, 4);
assert.equal(fixtureStats.assists, null);

/* -------------------------------------------------------------------- */
/* API uç noktası                                                        */
/* -------------------------------------------------------------------- */

const routeHandler = require("../api/[...route].js");

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    }
  };
}

const response = mockResponse();
await routeHandler({ method: "GET", url: "/api/player-detail?id=kerem-akturkoglu" }, response);
const payload = JSON.parse(response.body);

assert.equal(payload.ok, true);
assert.ok(Array.isArray(payload.data), "player-detail yanıtı dizi sözleşmesini korumalı");
assert.equal(payload.data.length, 1);
assert.ok(payload.data[0].profile, "player-detail profil bloğunu döndürmeli");
assert.equal(payload.data[0].profile.id, "kerem-akturkoglu");
assert.equal(payload.meta.matchLogSource, "unavailable", "sağlayıcı yokken maç kaydı kaynağı bekliyor olarak raporlanmalı");

const missingResponse = mockResponse();
await routeHandler({ method: "GET", url: "/api/player-detail?id=olmayan-oyuncu" }, missingResponse);
const missingPayload = JSON.parse(missingResponse.body);
assert.equal(missingPayload.ok, false);
assert.equal(missingPayload.error.code, "PLAYER_NOT_FOUND");

console.log("FutbolRadar player profile tests passed (metrikler, skor, form trendi, boş durumlar, görünüm, sağlayıcı normalizasyonu, API sözleşmesi).");
