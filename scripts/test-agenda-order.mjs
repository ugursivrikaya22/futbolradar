/**
 * GÜNDEM SIRASI TESTLERİ
 *
 * İstenen sıra:
 *   1. Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor maçları
 *   2. Türk kulüplerinin Avrupa maçları
 *   3. Trendyol Süper Lig maçları
 *   4. Kesinleşmiş transferler
 *   5. Maç sonu açıklamaları
 *   6. Tamamlanan maç raporları
 *   7. Düşük ilgili hazırlık maçları
 *
 * Sözleşme:
 *   1. Tür sınırı aşılmaz: hiçbir tazelik bir transferi büyük maçın üstüne çıkaramaz.
 *   2. Tür içinde tazelik ve maç önceliği sıralar.
 *   3. Bant kaynak sırası bu sırayla aynıdır.
 *   4. Tanınmayan tür sessizce silinmez, en alta düşer.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TIER, TIER_REASONS, agendaScore, isBigFour, matchTier, rankAgenda } =
  require("../services/agendaService.js");
const { SOURCES } = require("../services/tickerService.js");

const NOW = new Date("2026-07-29T12:00:00+03:00");
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

const match = (home, away, league, extra = {}) => ({
  type: "match",
  at: NOW.toISOString(),
  match: { homeTeam: home, awayTeam: away, league, kickoff: NOW.toISOString(), ...extra }
});

/** Bant sırası istenen sırayla aynı. */
function testTierOrderMatchesTheBrief() {
  const order = ["bigFourMatch", "turkishInEurope", "superLigMatch",
    "confirmedTransfer", "statement", "matchReport", "friendly"];

  for (let index = 1; index < order.length; index += 1) {
    assert.ok(
      TIER[order[index - 1]] > TIER[order[index]],
      `${order[index - 1]} bandı ${order[index]} bandının üstünde olmalı`
    );
  }

  // Her bandın okunabilir bir gerekçesi olmalı.
  for (const tier of order) {
    assert.ok(TIER_REASONS[tier], `${tier} gerekçesiz olmamalı`);
  }
}

/** Maç hangi banda düşüyor? */
function testMatchTiers() {
  assert.equal(matchTier(match("Galatasaray", "Rennes", "Hazırlık maçı").match), "bigFourMatch");
  assert.equal(matchTier(match("Kasımpaşa", "Fenerbahçe", "Trendyol Süper Lig").match), "bigFourMatch");
  assert.equal(
    matchTier(match("Samsunspor", "AEK Athens", "UEFA Konferans Ligi").match, { turkishClubs: ["Samsunspor"] }),
    "turkishInEurope"
  );
  assert.equal(matchTier(match("Göztepe", "Kasımpaşa", "Trendyol Süper Lig").match), "superLigMatch");
  assert.equal(matchTier(match("Rudeš", "Slaven Belupo", "Hazırlık maçı").match), "friendly");

  for (const club of ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"]) {
    assert.ok(isBigFour(club), `${club} büyük dörtlüde olmalı`);
  }
  assert.equal(isBigFour("Göztepe"), false);
  assert.equal(isBigFour(""), false);
}

/**
 * TÜR SINIRI AŞILMAZ.
 *
 * Bugün kesinleşmiş bir transfer, iki hafta sonraki bir Galatasaray maçının
 * üstüne çıkamaz. Aksi hâlde "önce büyük maçlar" sözü, yeterince yeni bir
 * kaydın her zaman bozabileceği bir temenniye dönerdi.
 */
function testTypeBoundaryHolds() {
  const freshTransfer = { type: "transfer", at: NOW.toISOString() };
  const bigMatch = match("Galatasaray", "Rennes", "Hazırlık maçı");
  const superLig = match("Göztepe", "Kasımpaşa", "Trendyol Süper Lig");

  const ranked = rankAgenda([freshTransfer, superLig, bigMatch], { now: NOW });
  assert.deepEqual(
    ranked.map((entry) => entry.agenda.tier),
    ["bigFourMatch", "superLigMatch", "confirmedTransfer"],
    "en taze transfer bile maçların üstüne çıkmamalı"
  );

  // En eski maç bile en taze transferin üstünde.
  const staleMatch = { ...bigMatch, at: daysAgo(30) };
  const boundary = rankAgenda([freshTransfer, staleMatch], { now: NOW });
  assert.equal(boundary[0].agenda.tier, "bigFourMatch");

  // Bant payı hiçbir zaman bandın kendisini aşmamalı.
  for (const entry of ranked) {
    assert.ok(entry.agenda.share <= 99, `bant payı taşmış: ${entry.agenda.share}`);
    assert.ok(entry.agenda.share >= 0);
  }
}

/** Tür içinde tazelik sıralar. */
function testFreshnessSortsWithinTier() {
  const ranked = rankAgenda([
    { type: "transfer", at: daysAgo(20), id: "eski" },
    { type: "transfer", at: daysAgo(1), id: "yeni" },
    { type: "transfer", at: daysAgo(9), id: "orta" }
  ], { now: NOW });

  assert.deepEqual(ranked.map((entry) => entry.id), ["yeni", "orta", "eski"]);

  // Hepsi aynı bantta kalmalı — eski kayıt silinmiyor, sadece geriliyor.
  for (const entry of ranked) assert.equal(entry.agenda.tier, "confirmedTransfer");
}

/** Açıklama raporun, rapor hazırlık maçının üstünde. */
function testNonMatchTypesFollowTheBrief() {
  const ranked = rankAgenda([
    { type: "report", at: NOW.toISOString(), id: "rapor" },
    { type: "statement", at: NOW.toISOString(), id: "aciklama" },
    { type: "transfer", at: NOW.toISOString(), id: "transfer" }
  ], { now: NOW });

  assert.deepEqual(ranked.map((entry) => entry.id), ["transfer", "aciklama", "rapor"]);
}

/** Tanınmayan tür sessizce kaybolmaz. */
function testUnknownTypeSinksButSurvives() {
  const ranked = rankAgenda([
    { type: "bilinmeyen", at: NOW.toISOString(), id: "x" },
    { type: "report", at: daysAgo(60), id: "rapor" }
  ], { now: NOW });

  assert.equal(ranked.length, 2, "tanınmayan kayıt listeden düşmemeli");
  assert.equal(ranked.at(-1).id, "x");
  assert.equal(ranked.at(-1).agenda.tier, "unknown");
}

/**
 * BANT SIRASI GÜNDEM SIRASIYLA AYNI.
 *
 * Bant ile bülten farklı sıra kullansaydı okuyucu aynı günün gündemini iki
 * farklı düzende okurdu.
 */
function testTickerFollowsTheSameOrder() {
  const byPriority = [...SOURCES].sort((left, right) => left.priority - right.priority).map((source) => source.id);
  assert.deepEqual(
    byPriority,
    ["live", "today", "result", "transfer", "statement", "news"],
    "bant kaynak sırası gündem sırasıyla ayrışmış"
  );
}

/** Boş ve bozuk girdi çökertmemeli. */
function testDegradesSafely() {
  assert.deepEqual(rankAgenda(null, { now: NOW }), []);
  assert.deepEqual(rankAgenda([], { now: NOW }), []);
  assert.equal(agendaScore(null, { now: NOW }).score, 0);
  assert.equal(agendaScore({ type: "match", match: null }, { now: NOW }).tier, "friendly");
}

const tests = [
  testTierOrderMatchesTheBrief,
  testMatchTiers,
  testTypeBoundaryHolds,
  testFreshnessSortsWithinTier,
  testNonMatchTypesFollowTheBrief,
  testUnknownTypeSinksButSurvives,
  testTickerFollowsTheSameOrder,
  testDegradesSafely
];

for (const test of tests) test();

console.log(`Agenda order tests passed (${tests.length} senaryo: bant sırası, maç bantları, ` +
  "tür sınırı, bant içi tazelik, maç dışı türler, tanınmayan tür, bant eşliği, güvenli bozulma).");
