/**
 * GÖRÜNÜR KART GÜVENİLİRLİĞİ TESTLERİ
 *
 * Denetimin bulduğu tablo (2026-07): 110 oyuncu kaydının hiçbiri yayın
 * barını geçmiyor. 102'sinde sağlayıcı kimliği hiç yok, 8'inde "mock-..."
 * yer tutucu var — ve puan/piyasa değeri/dakika taşıyan tek grup da aynı
 * sekiz. Ana sayfadaki üç kart (Icardi, Aktürkoğlu, Dzeko) buradan
 * geliyordu; ikisi ligde bile oynamıyordu.
 *
 * Sözleşme:
 *   1. Yer tutucu kimlikli kart gizlenir.
 *   2. Sağlayıcı kimliği olmayan kart gizlenir.
 *   3. Bayat kayıt gizlenir.
 *   4. Ligde oynamayan oyuncu trend bölümüne girmez.
 *   5. Doğrulanmış kayıt KALIR — süzgeç her şeyi elemiyor, ayırt ediyor.
 *   6. Ana sayfa yanıltıcı kart basmaz; veri yoksa temiz boş durum.
 *   7. İstemci ve servis aynı kuralı uygular.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const credibility = require("../services/cardCredibility.js");
const { fixtureTeamNames } = require("../services/superLigTeams.js");

const now = new Date("2026-07-26T21:00:00+03:00");

/** Barı geçen örnek kayıt: kadro senkronu gerçek veriyi getirdiğinde bu şekle benzer. */
const verified = {
  id: "dogrulanmis-oyuncu",
  name: "Doğrulanmış Oyuncu",
  providerId: "276",
  currentTeam: "Galatasaray",
  position: "Forvet",
  sourceUrl: "https://media.api-sports.io/football/players/276.png",
  lastVerifiedAt: "2026-07-20T12:00:00+03:00",
  dataStatus: "verified",
  ratingStatus: "current"
};

function testVerifiedPlayerRemains() {
  const verdict = credibility.evaluatePlayerCard(verified, { now });
  assert.equal(verdict.publishable, true, `doğrulanmış kayıt kalmalı: ${verdict.reasons.join("; ")}`);
  assert.equal(verdict.confidence, "high");

  const trend = credibility.evaluateTrendPlayerCard(verified, { now, leagueTeams: fixtureTeamNames() });
  assert.equal(trend.publishable, true, `ligdeki doğrulanmış oyuncu trendde kalmalı: ${trend.reasons.join("; ")}`);
}

function testMockPlayerRemoved() {
  for (const id of ["mock-icardi-9", "mock_kerem_7", "MOCK-1"]) {
    const verdict = credibility.evaluatePlayerCard({ ...verified, providerId: id }, { now });
    assert.equal(verdict.publishable, false, `"${id}" yer tutucu kimlik gizlenmeli`);
    assert.ok(verdict.reasons.some((reason) => /mock/i.test(reason)), "gerekçe yer tutucuyu söylemeli");
  }
}

function testPlayerWithoutProviderIdHidden() {
  for (const id of ["", null, undefined, "abc", "gs-1"]) {
    const verdict = credibility.evaluatePlayerCard({ ...verified, providerId: id }, { now });
    assert.equal(verdict.publishable, false, `"${id}" kimliğiyle kart gizlenmeli`);
  }
}

function testStalePlayerRemoved() {
  // Bayat derecelendirme.
  assert.equal(
    credibility.evaluatePlayerCard({ ...verified, ratingStatus: "stale" }, { now }).publishable,
    false, "bayat puanlı kart gizlenmeli"
  );

  // Doğrulama penceresi aşılmış.
  const old = { ...verified, lastVerifiedAt: "2026-01-01T12:00:00+03:00" };
  const verdict = credibility.evaluatePlayerCard(old, { now });
  assert.equal(verdict.publishable, false, "aylar önce doğrulanmış kayıt trendde durmamalı");
  assert.ok(verdict.reasons.some((reason) => /gün önce/.test(reason)), "gerekçe yaşı söylemeli");

  // Pencerenin içindeki kayıt kalmalı — süzgeç körü körüne elemiyor.
  assert.equal(
    credibility.evaluatePlayerCard({ ...verified, lastVerifiedAt: "2026-07-10T12:00:00+03:00" }, { now }).publishable,
    true, "pencere içindeki kayıt kalmalı"
  );
}

function testUnsourcedPlayerHidden() {
  assert.equal(
    credibility.evaluatePlayerCard({ ...verified, sourceUrl: "" }, { now }).publishable,
    false, "kaynağı olmayan kart gizlenmeli"
  );
  assert.equal(
    credibility.evaluatePlayerCard({ ...verified, lastVerifiedAt: "" }, { now }).publishable,
    false, "doğrulama zamanı olmayan kart gizlenmeli"
  );
  assert.equal(
    credibility.evaluatePlayerCard({ ...verified, dataStatus: "mock_needs_verification" }, { now }).publishable,
    false, "doğrulama bekleyen kayıt gizlenmeli"
  );
}

function testPlayerOutsideLeagueExcludedFromTrend() {
  const leagueTeams = fixtureTeamNames();

  // Serbest oyuncu — trend bölümünün en yanıltıcı hâli.
  const free = credibility.evaluateTrendPlayerCard({ ...verified, currentTeam: "Serbest oyuncu" }, { now, leagueTeams });
  assert.equal(free.publishable, false, "serbest oyuncu trendde görünmemeli");
  assert.ok(free.reasons.some((reason) => /serbest/i.test(reason)));

  // Yurt dışına gitmiş oyuncu.
  for (const club of ["Schalke 04", "Rennes", "Spartak Moskova"]) {
    const verdict = credibility.evaluateTrendPlayerCard({ ...verified, currentTeam: club }, { now, leagueTeams });
    assert.equal(verdict.publishable, false, `${club} oyuncusu Süper Lig trendinde görünmemeli`);
    assert.ok(verdict.reasons.some((reason) => /lig dışında/.test(reason)));
  }

  // Ligdeki kulüp geçmeli.
  assert.equal(
    credibility.evaluateTrendPlayerCard({ ...verified, currentTeam: "Göztepe" }, { now, leagueTeams }).publishable,
    true, "ligdeki kulübün oyuncusu trendde kalmalı"
  );
}

function testSourceMetadataIsCarried() {
  const meta = credibility.sourceMetadata(verified, { now });
  for (const key of ["source_name", "source_url", "last_verified_at", "provider_id", "data_confidence"]) {
    assert.ok(key in meta, `künye ${key} alanını taşımalı`);
  }
  assert.equal(meta.provider_id, "276");
  assert.equal(meta.data_confidence, "high");

  assert.equal(credibility.sourceMetadata({ ...verified, providerId: "mock-x" }, { now }).data_confidence, "none");
}

function testHomepageRendersNoMisleadingCards() {
  const home = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

  // Denetimin elediği isimler artık OYUNCU KARTI olarak görünmemeli.
  //
  // Dikkat: aynı isim doğrulanmış bir TRANSFER kaydında geçebilir ve bu
  // meşrudur — "Mauro Icardi, Serbest oyuncu (2026-07-16)" kaynaklı ve
  // onaylı bir harekettir. Yasak olan, o oyuncuyu doğrulanmamış bir puanla
  // trend kartı diye göstermek. Bu yüzden iddia kart bloklarına bakıyor,
  // sayfadaki her geçişe değil.
  const playerCards = home.match(/<article[^>]*data-card="player"[\s\S]*?<\/article>/g) || [];
  for (const name of ["Mauro Icardi", "Edin Dzeko", "Kerem Aktürkoğlu"]) {
    assert.ok(
      !playerCards.some((card) => card.includes(name)),
      `"${name}" doğrulanmamış oyuncu kartı olarak basılmamalı`
    );
  }

  // Puan rozeti taşıyan hiçbir kart doğrulanmamış kayıttan gelmemeli.
  assert.ok(
    !home.includes("player-rating-badge") || playerCards.length > 0,
    "puan rozeti yalnızca yayımlanan bir kartın parçası olabilir"
  );

  // Yer tutucu kimlik hiçbir biçimde sayfaya sızmamalı.
  assert.ok(!/mock-[a-z]+-\d+/i.test(home), "yer tutucu sağlayıcı kimliği sayfaya sızmamalı");

  // Doğrulanmış kayıt yokken temiz boş durum basılmalı.
  const { kept } = credibility.filterPlayerCards(require("../data/players.json"), {
    trend: true,
    leagueTeams: fixtureTeamNames()
  });
  if (!kept.length) {
    assert.ok(home.includes('data-card="empty-state"'), "doğrulanmış kart yokken boş durum basılmalı");
    assert.ok(home.includes("Veri bekleniyor"), "boş durum açıkça veri beklendiğini söylemeli");
    assert.ok(!home.includes('data-card="player"'), "doğrulanmamış oyuncu kartı basılmamalı");
  }
}

function testClientMirrorsServiceExactly() {
  // Süzgeç iki yerde yaşıyor: statik ön render (servis) ve tarayıcı (app.js).
  // İstemci gevşek olsaydı, ön render kartı elerdi ama JS yüklendiğinde geri
  // gelirdi — okuyucu için düzeltilmiş görünen bir sayfa yeniden bozulurdu.
  const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const start = app.indexOf("function isPublishablePlayerCard");
  assert.ok(start > -1, "app.js istemci süzgecini tanımlamalı");

  const body = app.slice(start, app.indexOf("function playerInitials"));
  const clientFilter = new Function(`return ${body.slice(0, body.lastIndexOf("}") + 1)}`)();

  const players = require("../data/players.json");
  for (const player of players) {
    assert.equal(
      clientFilter(player),
      credibility.evaluatePlayerCard(player).publishable,
      `${player.name}: istemci ve servis aynı kararı vermeli`
    );
  }
}

function testAuditCountsAreHonest() {
  // Denetimin sayıları rapor edilebilir olmalı: kaç kart elendi, neden.
  const players = require("../data/players.json");
  const { kept, removed } = credibility.filterPlayerCards(players, {
    trend: true,
    leagueTeams: fixtureTeamNames()
  });

  assert.equal(kept.length + removed.length, players.length, "her kayıt bir tarafa düşmeli");
  for (const item of removed) {
    assert.ok(item.reasons.length, `${item.id}: eleme gerekçesiz olmamalı`);
  }
}

const tests = [
  testVerifiedPlayerRemains,
  testMockPlayerRemoved,
  testPlayerWithoutProviderIdHidden,
  testStalePlayerRemoved,
  testUnsourcedPlayerHidden,
  testPlayerOutsideLeagueExcludedFromTrend,
  testSourceMetadataIsCarried,
  testHomepageRendersNoMisleadingCards,
  testClientMirrorsServiceExactly,
  testAuditCountsAreHonest
];

for (const test of tests) {
  test();
}

console.log(`Card credibility tests passed (${tests.length} senaryo: doğrulanmış kalır, mock elenir, ` +
  "kimliksiz gizlenir, bayat elenir, kaynaksız gizlenir, lig dışı trendde yok, künye, " +
  "ana sayfa yanıltmaz, istemci-servis eşliği, denetim sayıları).");
