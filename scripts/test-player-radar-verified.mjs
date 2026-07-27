/**
 * OYUNCU RADARI ve ANA SAYFA ETKİ BLOĞU — DOĞRULANMIŞ VERİ SÖZLEŞMESİ
 *
 * Denetimin bulduğu üç ayrı iddia türü burada sabitleniyor:
 *
 *   1. ALAN İDDİASI — rozetteki puan, "Gol 0", "Dakika 0", dolu radar.
 *      Ölçüm yokken basılıyordu.
 *   2. SIRALAMA İDDİASI — "en yüksek AI rating", "trend oyuncu". Kart
 *      üstünde sayı basılmasa bile SEÇİM bir üstünlük iddiasıdır ve
 *      türetilmiş bir varsayılandan yapılıyordu. Ana sayfadaki üç trend
 *      kartının üç yedek kaleci olmasının sebebi buydu.
 *   3. GRAFİK İDDİASI — altı eksenli radar. İki ekseni (Disiplin 72,
 *      Veri 68) hiç ölçülmeden sabit yazılıydı.
 *
 * Sözleşme: ölçüm yoksa alan basılmaz, sıralama yapılmaz, grafik çizilmez
 * ve yerine temiz bir boş durum gelir. Sıfır ya da tire basılmaz.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const credibility = require("../services/cardCredibility.js");
const statsSync = require("../services/playerStatsSyncService.js");
const players = require("../data/players.json");

const root = process.cwd();
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");

/* ------------------------------------------------------------------ *
 * 1. RADAR EKSENLERİ ÖLÇÜMDEN GELİR
 * ------------------------------------------------------------------ */

// Sabit eksen değerleri kaldırıldı — geri gelirlerse burada düşer.
assert.ok(
  !/discipline:\s*radar\.discipline\s*!=\s*null\s*\?\s*radar\.discipline\s*:\s*72/.test(appSource),
  "sabit 'discipline: 72' ekseni geri gelmiş — ölçülmemiş eksen çizilmemeli"
);
assert.ok(
  !/dataConfidence:\s*radar\.dataConfidence\s*!=\s*null\s*\?\s*radar\.dataConfidence\s*:\s*68/.test(appSource),
  "sabit 'dataConfidence: 68' ekseni geri gelmiş — ölçülmemiş eksen çizilmemeli"
);

// Ölçümü olmayan kayıtta hiçbir eksen açılmaz.
const unmeasured = {
  id: "r1", name: "Ölçümsüz", providerId: "2001",
  sourceUrl: "https://v3.football.api-sports.io/players/squads?player=2001",
  lastVerifiedAt: new Date().toISOString(),
  dataStatus: "provider", ratingStatus: "estimated",
  formRating: 61, threatScore: 40, creativityScore: 38, pressingScore: 44
};
assert.deepEqual(
  credibility.verifiedRadarAxes(unmeasured),
  [],
  "türetilmiş eksenler radar çizmemeli"
);

// Ölçüm geldiğinde eksenler açılır.
const measured = {
  ...unmeasured,
  id: "r2", providerId: "2002",
  ratingStatus: "provider",
  ratingVerifiedAt: new Date().toISOString(),
  ratingSource: "API-Football",
  appearances: 14, minutes: 1150
};
const axes = credibility.verifiedRadarAxes(measured);
assert.ok(axes.length >= 4, `ölçülmüş kayıtta eksenler açılmalı (bulunan: ${axes.length})`);
assert.ok(
  axes.every((axis) => Number.isFinite(axis.value)),
  "her eksen sonlu bir sayı taşımalı"
);

/* ------------------------------------------------------------------ *
 * 2. SIRALAMA ÖLÇÜLMÜŞ ALANDAN YAPILIR
 * ------------------------------------------------------------------ */

// Ölçülmemiş alandan sıralama yapılamaz — liste boş döner.
assert.deepEqual(
  credibility.rankByVerifiedMetric([unmeasured], "overallRating"),
  [],
  "türetilmiş dereceden sıralama yapılmamalı"
);

// Ölçülmüş alandan sıralama yapılır ve büyükten küçüğe gelir.
const rankPool = [
  { ...measured, id: "p-low", providerId: "3001", overallRating: 6.1 },
  { ...measured, id: "p-high", providerId: "3002", overallRating: 8.3 },
  { ...measured, id: "p-mid", providerId: "3003", overallRating: 7.2 },
  { ...unmeasured, id: "p-unmeasured", providerId: "3004", overallRating: 99 }
];
const ranked = credibility.rankByVerifiedMetric(rankPool, "overallRating");
assert.equal(ranked.length, 3, "yalnızca ölçülmüş kayıtlar sıralanmalı");
assert.deepEqual(
  ranked.map((entry) => entry.player.id),
  ["p-high", "p-mid", "p-low"],
  "sıralama büyükten küçüğe olmalı"
);
assert.ok(
  !ranked.some((entry) => entry.player.id === "p-unmeasured"),
  "ölçülmemiş kayıt 99 puanla bile sıralamaya girmemeli"
);

const limited = credibility.rankByVerifiedMetric(rankPool, "overallRating", { limit: 2 });
assert.equal(limited.length, 2, "limit uygulanmalı");

/* ------------------------------------------------------------------ *
 * 3. GERÇEK VERİ KÜMESİ — bugünkü hâlin doğru sonucu BOŞ OLMAK
 * ------------------------------------------------------------------ */

const verifiedRatings = credibility.rankByVerifiedMetric(players, "overallRating");
const withAxes = players.filter((player) => credibility.verifiedRadarAxes(player).length);

// Bu iki sayı bugün sıfır. Sıfır olmadıkları gün ölçüm gelmiş demektir ve
// bu test o zaman da geçerlidir — asıl iddia şu: sıralamaya giren HER kayıt
// ölçüm damgası taşımalı.
for (const entry of verifiedRatings) {
  assert.ok(
    credibility.ratingIsVerified(entry.player),
    `sıralamadaki kayıt ölçülmüş derece taşımalı: ${entry.player.id}`
  );
}
for (const player of withAxes) {
  assert.ok(
    credibility.ratingIsVerified(player) || credibility.statsAreVerified(player),
    `radar ekseni olan kayıt ölçüm taşımalı: ${player.id}`
  );
}

/* ------------------------------------------------------------------ *
 * 4. BOŞ DURUM — ön render ve istemci, ölçüm yokken temiz boş durum basar
 * ------------------------------------------------------------------ */

assert.ok(
  /data-empty-reason="no-verified-players"/.test(appSource),
  "istemci radar listesi için temiz boş durum basmalı"
);
assert.ok(
  /data-empty-reason="player-signals-unverified"/.test(appSource),
  "istemci etki bloğu için temiz boş durum basmalı"
);

// Boş durumda BAYAT STATİK HTML'E DÖNÜLMEZ: staticFallback ön renderin
// bastığı kartları taşıyor; onları geri boyamak kaldırılan iddiayı geri
// getirirdi.
const radarEmptyBranch = appSource.slice(
  appSource.indexOf("no-verified-players") - 900,
  appSource.indexOf("no-verified-players")
);
assert.ok(
  !/target\.innerHTML\s*=\s*staticFallback/.test(radarEmptyBranch),
  "boş durum bayat statik HTML'e dönmemeli"
);

// Ana sayfa ve radar sayfası, doğrulanmamış kayıt için puan rozeti basmamalı.
for (const file of ["index.html", "oyuncu-radari.html"]) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  assert.ok(
    !/player-rating-badge/.test(html),
    `${file} doğrulanmamış puan rozeti basmamalı`
  );
  assert.ok(
    !/mock-[a-z]+-\d+/i.test(html),
    `${file} mock kimlik taşımamalı`
  );
}

/* ------------------------------------------------------------------ *
 * 5. İSTATİSTİK SENKRONU — ölçümü damgalar, sıfırı damgalamaz
 * ------------------------------------------------------------------ */

// Sezon öncesi: sağlayıcı kayıtlı ama oynamamış oyuncu döndürür. Bunu
// "doğrulanmış istatistik" saymak, siteyi baştan sona "Dakika 0, Gol 0"
// yapardı — okuyucu bunu "oynadı, üretemedi" diye okur.
const preseasonItem = {
  player: { id: 7001, name: "Sezon Öncesi" },
  statistics: [{ games: { appearences: 0, minutes: 0, rating: null }, goals: { total: null, assists: null } }]
};
assert.equal(
  statsSync.buildVerifiedStatsPatch(preseasonItem),
  null,
  "oynanmamış sezonda istatistik damgası basılmamalı"
);

// Oynanmış sezon: sayaçlar ve derece damgalanır.
const playedItem = {
  player: { id: 7002, name: "Oynamış" },
  statistics: [{
    games: { appearences: 18, minutes: 1520, rating: "7.283" },
    goals: { total: 6, assists: 4 },
    cards: { yellow: 3, red: 0 },
    shots: { total: 31 },
    passes: { key: 22, accuracy: 84 },
    duels: { total: 190, won: 101 }
  }]
};
const patch = statsSync.buildVerifiedStatsPatch(playedItem, { observedAt: "2026-09-01T10:00:00.000Z" });
assert.ok(patch, "oynanmış sezonda yama üretilmeli");
assert.equal(patch.appearances, 18);
assert.equal(patch.goals, 6);
assert.equal(patch.assists, 4);
assert.equal(patch.statsSource, "API-Football");
assert.equal(patch.statsVerifiedAt, "2026-09-01T10:00:00.000Z");
assert.equal(patch.ratingStatus, "provider");
assert.equal(patch.ratingSource, "API-Football");
assert.ok(Math.abs(patch.rating - 7.283) < 1e-9, "derece sağlayıcıdan birebir alınmalı");

// Yamayı uygulanmış kayıt yayın kapısını ve alan kapısını geçmeli:
// senkronun ürettiği damgaların gerçekten kapıyı açtığı burada kanıtlanır.
const synced = {
  id: "synced", name: "Senkron", providerId: "7002",
  ...patch
};
assert.equal(credibility.evaluatePlayerCard(synced).publishable, true, "damgalı kayıt kapıyı geçmeli");
assert.equal(credibility.ratingIsVerified(synced), true, "senkron derecesi doğrulanmış sayılmalı");
assert.equal(credibility.statsAreVerified(synced), true, "senkron sayaçları doğrulanmış sayılmalı");

// Gönderilmeyen alan yamaya GİRMEZ — sıfırla doldurulmaz.
const partialItem = {
  player: { id: 7003, name: "Kısmi" },
  statistics: [{ games: { appearences: 5, minutes: 300, rating: null }, goals: { total: null, assists: 2 } }]
};
const partial = statsSync.buildVerifiedStatsPatch(partialItem);
assert.ok(partial, "kısmi ölçüm yama üretmeli");
assert.equal(partial.assists, 2);
assert.ok(!("goals" in partial), "sağlayıcı göndermediyse gol alanı yamaya girmemeli");
assert.ok(!("ratingStatus" in partial), "derece gelmediyse derece damgası basılmamalı");
assert.equal(credibility.ratingIsVerified({ ...partial }), false, "derecesiz yama derece kapısını açmamalı");

// ELLE DOĞRULANMIŞ KAYIT EZİLMEZ.
const manual = { id: "m1", name: "Elle", providerId: "7004", ratingStatus: "verified", overallRating: 91 };
const applied = statsSync.applyStatsPatch(manual, patch);
assert.equal(applied.changed, false, "elle doğrulanmış kayıt sağlayıcı tarafından ezilmemeli");
assert.equal(applied.player.overallRating, 91, "yerel değer korunmalı");
assert.ok(applied.conflict, "çakışma sessizce kaybolmamalı");

// GÜVENLİK KAPISI: boş ya da yarım çekim üretim verisini EZMEZ.
assert.equal(statsSync.evaluateStatsSyncSafety({ requested: 479, measured: 0, failures: 0 }).safe, false,
  "ölçüm gelmediyse yazılmamalı");
assert.equal(statsSync.evaluateStatsSyncSafety({ requested: 479, measured: 100, failures: 0 }).safe, false,
  "kapsama eşiğin altındaysa yazılmamalı");
assert.equal(statsSync.evaluateStatsSyncSafety({ requested: 479, measured: 400, failures: 0 }).safe, true,
  "yeterli kapsamada yazılmalı");
assert.equal(statsSync.evaluateStatsSyncSafety({ requested: 0, measured: 0, failures: 0 }).safe, false,
  "hedef yokken yazılmamalı");

/* ------------------------------------------------------------------ *
 * 6. SENKRON ANAHTARSIZ SESSİZ NO-OP OLMAZ
 * ------------------------------------------------------------------ */

const syncSource = fs.readFileSync(path.join(root, "scripts", "sync-player-statistics.mjs"), "utf8");
assert.ok(
  /reportMissingProviderConfig/.test(syncSource),
  "anahtar yoksa eksik yapılandırma adıyla bildirilmeli"
);
assert.ok(
  /process\.exitCode = 1/.test(syncSource),
  "eksik yapılandırma çıkış kodunu düşürmeli"
);
assert.ok(
  /evaluateStatsSyncSafety/.test(syncSource),
  "yazma öncesi güvenlik kapısı çağrılmalı"
);

console.log(`OK oyuncu radarı doğrulanmış veri sözleşmesi · ` +
  `${players.length} kayıt · ölçülmüş derece: ${verifiedRatings.length} · radar ekseni olan: ${withAxes.length}`);
