/**
 * MAÇ ÖNCELİK PUANI TESTLERİ
 *
 * Kabul ölçütleri (istek metninden birebir):
 *   1. Ana sayfanın üst sıraları yüksek öncelikli maçları gösterir.
 *   2. Avrupa'da oynayan Türk takımları öne çıkar.
 *   3. Derbiler öne çıkar.
 *   4. Gerekçeler görünür.
 *   5. Sıralamayı YALNIZCA saat belirlemez.
 * Ek sözleşme:
 *   6. Düşük öncelikli maçlar ELENMEZ, yalnızca aşağı iner.
 *   7. Editoryal geçersiz kılma çalışır ve gerekçe üretir.
 *   8. Sıralama verisi yokken "zirve mücadelesi" İDDİA EDİLMEZ.
 *   9. İstemci (app.js) aynı katsayıları kullanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  CLUB_POPULARITY,
  HIGH_INTEREST_THRESHOLD,
  TURKISH_BIG_FOUR,
  WEIGHTS,
  clubPopularity,
  competitionProfile,
  matchPriority,
  rankMatches
} = require("../services/matchPriorityService.js");

const NOW = new Date("2026-07-29T18:00:00+03:00");
const at = (time) => `2026-07-29T${time}:00+03:00`;

const FRIENDLY = { id: "friendly", homeTeam: "Konyaspor", awayTeam: "Ittihad Kalba", league: "Hazırlık Maçı", competitionId: "hazirlik-maci", kickoff: at("19:00"), status: "SCHEDULED" };
const UCL_TR = { id: "ucl", homeTeam: "Górnik Zabrze", awayTeam: "Fenerbahçe", league: "UEFA Şampiyonlar Ligi", competitionId: "sampiyonlar-ligi", kickoff: at("21:00"), status: "SCHEDULED" };
const DERBY = { id: "derby", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", league: "Trendyol Süper Lig", competitionId: "super-lig", kickoff: at("20:00"), status: "SCHEDULED" };
const SMALL_LEAGUE = { id: "small", homeTeam: "Çorum FK", awayTeam: "Erzurumspor FK", league: "Trendyol Süper Lig", competitionId: "super-lig", kickoff: at("17:00"), status: "SCHEDULED" };
const LIVE_FRIENDLY = { id: "live", homeTeam: "Kasımpaşa", awayTeam: "Hull City", league: "Hazırlık Maçı", competitionId: "hazirlik-maci", kickoff: at("16:00"), status: "LIVE", score: { home: 1, away: 1 } };

const rank = (list) => rankMatches(list, { now: NOW }).map((item) => item.id);
const reasonKeys = (match) => matchPriority(match, { now: NOW }).reasons.map((item) => item.key);

/** Canlı maç her şeyin üstünde. */
function testLiveGoesTop() {
  const order = rank([FRIENDLY, UCL_TR, DERBY, LIVE_FRIENDLY]);
  assert.equal(order[0], "live", `canlı maç en üstte olmalı, sıra: ${order.join(" > ")}`);
  assert.ok(reasonKeys(LIVE_FRIENDLY).includes("live"), "canlı maç gerekçe taşımalı");
}

/** Derbi öne çıkar ve gerekçesi yazılır. */
function testDerbyIsSurfaced() {
  const order = rank([FRIENDLY, SMALL_LEAGUE, DERBY]);
  assert.equal(order[0], "derby", `derbi en üstte olmalı, sıra: ${order.join(" > ")}`);
  assert.ok(reasonKeys(DERBY).includes("derby"), "derbi gerekçesi yazılmalı");

  // Dört büyüğün TAMAMI derbi tarafı sayılmalı.
  for (const club of TURKISH_BIG_FOUR) {
    assert.ok(CLUB_POPULARITY[club] >= 95, `${club} en üst ilgi katmanında olmalı`);
  }
}

/** Avrupa'da Türk takımı öne çıkar. */
function testTurkishSideInEuropeIsSurfaced() {
  const order = rank([FRIENDLY, SMALL_LEAGUE, UCL_TR]);
  assert.equal(order[0], "ucl", `Avrupa maçı en üstte olmalı, sıra: ${order.join(" > ")}`);
  assert.ok(
    reasonKeys(UCL_TR).includes("turkishInEurope"),
    "Avrupa'da Türk takımı gerekçesi yazılmalı"
  );

  // Türk tarafı olmayan bir Avrupa maçı bu gerekçeyi ALMAMALI.
  const foreignTie = { ...UCL_TR, id: "foreign", homeTeam: "Ajax", awayTeam: "Benfica" };
  assert.ok(
    !reasonKeys(foreignTie).includes("turkishInEurope"),
    "Türk tarafı yokken bu gerekçe üretilmemeli"
  );
}

/**
 * SAAT TEK BAŞINA BELİRLEMEZ.
 *
 * En erken maç (17:00) en düşük öncelikli olduğunda listenin başında
 * olmamalı; en geç maç (21:00) yüksek öncelikliyse yukarı çıkmalı.
 */
function testTimeAloneDoesNotDominate() {
  const order = rank([SMALL_LEAGUE, FRIENDLY, UCL_TR]);
  const byTime = [SMALL_LEAGUE, FRIENDLY, UCL_TR]
    .slice()
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .map((item) => item.id);

  assert.notDeepEqual(order, byTime, "sıralama saf saat sıralamasıyla aynı olmamalı");
  assert.equal(order[0], "ucl", "en geç ama en önemli maç başa gelmeli");
}

/** Düşük öncelikli maçlar elenmez, yalnızca aşağı iner. */
function testLowPriorityStaysVisible() {
  const input = [FRIENDLY, UCL_TR, DERBY, SMALL_LEAGUE, LIVE_FRIENDLY];
  const order = rank(input);
  assert.equal(order.length, input.length, "hiçbir maç elenmemeli");
  assert.ok(order.includes("friendly"), "düşük öncelikli maç listede kalmalı");
  assert.equal(order[order.length - 1], "friendly", "en düşük öncelikli maç en altta olmalı");
}

/** Editoryal geçersiz kılma çalışır ve gerekçe üretir. */
function testEditorialOverride() {
  const featured = { ...FRIENDLY, id: "featured", featured: true };
  assert.ok(
    matchPriority(featured, { now: NOW }).score > matchPriority(FRIENDLY, { now: NOW }).score,
    "featured işareti puanı yükseltmeli"
  );
  assert.ok(reasonKeys(featured).includes("editorial"), "editör gerekçesi yazılmalı");

  const weighted = { ...FRIENDLY, id: "weighted", editorialPriority: 500 };
  const order = rank([weighted, UCL_TR, DERBY]);
  assert.equal(order[0], "weighted", "yeterince yüksek editoryal öncelik başa alabilmeli");
}

/**
 * SIRALAMA YOKSA ZİRVE MÜCADELESİ İDDİA EDİLMEZ.
 *
 * `teams.json` sezon başında `rank: null` taşıyor. Olmayan bir sıralamadan
 * "zirve mücadelesi" etiketi üretmek, ölçmediğimiz şeyi iddia etmek olurdu.
 */
function testNoStandingsClaimWithoutStandings() {
  const preseason = [
    { name: "Galatasaray", rank: null },
    { name: "Fenerbahçe", rank: null }
  ];
  const keys = matchPriority(DERBY, { now: NOW, teams: preseason }).reasons.map((item) => item.key);
  assert.ok(!keys.includes("titleRace"), "sıralama yokken zirve mücadelesi yazılmamalı");
  assert.ok(!keys.includes("relegationRace"), "sıralama yokken düşme hattı yazılmamalı");

  // Sıralama VARSA bileşen devreye girer.
  const ranked = [
    { name: "Galatasaray", rank: 1 },
    { name: "Fenerbahçe", rank: 2 },
    { name: "Beşiktaş", rank: 3 },
    { name: "Trabzonspor", rank: 4 }
  ];
  const withStandings = matchPriority(DERBY, { now: NOW, teams: ranked }).reasons.map((item) => item.key);
  assert.ok(withStandings.includes("titleRace"), "sıralama varken zirve mücadelesi yazılmalı");
}

/** Her yüksek puanlı maç bir gerekçe taşımalı; sessiz sıralama olmaz. */
function testHighScoreAlwaysExplains() {
  for (const match of [UCL_TR, DERBY, LIVE_FRIENDLY]) {
    const priority = matchPriority(match, { now: NOW });
    assert.ok(priority.primaryReason, `${match.id}: yüksek puanlı maç gerekçesiz olamaz`);
    assert.ok(priority.primaryReason.label.trim(), `${match.id}: gerekçe etiketi boş`);
  }

  // Eşik üstünde ama özel bağlamı olmayan maç da bir şey söylemeli.
  const generic = { ...SMALL_LEAGUE, id: "generic", homeTeam: "Real Madrid", awayTeam: "Barcelona", league: "La Liga", competitionId: "la-liga" };
  const priority = matchPriority(generic, { now: NOW });
  if (priority.score >= HIGH_INTEREST_THRESHOLD) {
    assert.ok(priority.primaryReason, "eşik üstündeki maç gerekçesiz kalmamalı");
  }
}

/** Turnuva ağırlıkları doğru sırada olmalı. */
function testCompetitionWeightOrder() {
  const ucl = competitionProfile({ competitionId: "sampiyonlar-ligi", league: "UEFA Şampiyonlar Ligi" }).weight;
  const uel = competitionProfile({ competitionId: "avrupa-ligi", league: "UEFA Avrupa Ligi" }).weight;
  const superLig = competitionProfile({ competitionId: "super-lig", league: "Trendyol Süper Lig" }).weight;
  const friendly = competitionProfile({ competitionId: "hazirlik-maci", league: "Hazırlık Maçı" }).weight;

  assert.ok(ucl > uel, "Şampiyonlar Ligi, Avrupa Ligi'nden ağır olmalı");
  assert.ok(uel > friendly, "Avrupa Ligi, hazırlık maçından ağır olmalı");
  assert.ok(superLig > friendly, "Süper Lig, hazırlık maçından ağır olmalı");
  assert.equal(
    competitionProfile({ competitionId: "super-lig", league: "Süper Lig" }).weight,
    superLig,
    "lig adı varyantı aynı ağırlığı vermeli"
  );
}

/** Bilinmeyen kulüp maçı elenmez, yalnızca taban puan alır. */
function testUnknownClubStillScores() {
  assert.ok(clubPopularity("Bilinmeyen SK") > 0, "bilinmeyen kulüp sıfır puan almamalı");
  const unknown = { ...FRIENDLY, id: "unknown", homeTeam: "Bilinmeyen SK", awayTeam: "Başka SK" };
  assert.ok(matchPriority(unknown, { now: NOW }).score > 0, "bilinmeyen kulüp maçı puanlanmalı");
}

/** İstemci (app.js) aynı katsayıları kullanmalı. */
function testClientMirrorsWeights() {
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const block = appJs.match(/var PRIORITY_CONFIG = (\{[\s\S]*?\});\n/);
  assert.ok(block, "app.js içinde öncelik yapılandırması bulunamadı");

  let client;
  assert.doesNotThrow(() => { client = JSON.parse(block[1]); }, "app.js yapılandırması geçerli JSON olmalı");

  assert.deepEqual(client.weights, { ...WEIGHTS }, "app.js ve servis katsayıları ayrışmış");
  assert.deepEqual(client.bigFour, [...TURKISH_BIG_FOUR], "dört büyük listesi ayrışmış");
  assert.equal(client.threshold, HIGH_INTEREST_THRESHOLD, "yüksek ilgi eşiği ayrışmış");
  assert.deepEqual(client.clubs, { ...CLUB_POPULARITY }, "kulüp ilgi tablosu ayrışmış");
}

/** Ana sayfanın üst sıraları gerçekten yüksek öncelikli olmalı. */
function testHomepageTopSlotsArePrioritised() {
  const homepage = path.join(root, "index.html");
  if (!fs.existsSync(homepage)) return;
  const html = fs.readFileSync(homepage, "utf8");

  const slot = html.match(/<!-- prerender:today-top-matches:start -->([\s\S]*?)<!-- prerender:today-top-matches:end -->/);
  if (!slot) return;

  const cards = slot[1].match(/<article class="fixture-card[\s\S]*?<\/article>/g) || [];
  if (cards.length < 2) return; // Tek maçlı günde sıralama iddiası test edilemez.

  // İlk kart bir gerekçe taşımalı ya da hiçbiri taşımamalı; gerekçesi olan
  // bir kart, gerekçesizin ALTINDA kalmamalı.
  const hasReason = cards.map((card) => /fixture-priority is-/.test(card));
  const firstWithout = hasReason.indexOf(false);
  const lastWith = hasReason.lastIndexOf(true);
  if (firstWithout !== -1 && lastWith !== -1) {
    assert.ok(
      lastWith < firstWithout,
      "gerekçeli maç, gerekçesiz maçın altında kalmamalı (öncelik sıralaması uygulanmamış)"
    );
  }
}

testLiveGoesTop();
testDerbyIsSurfaced();
testTurkishSideInEuropeIsSurfaced();
testTimeAloneDoesNotDominate();
testLowPriorityStaysVisible();
testEditorialOverride();
testNoStandingsClaimWithoutStandings();
testHighScoreAlwaysExplains();
testCompetitionWeightOrder();
testUnknownClubStillScores();
testClientMirrorsWeights();
testHomepageTopSlotsArePrioritised();

console.log(
  "Match priority tests passed (canlı üstte, derbi öne çıkar, Avrupa'da Türk takımı öne çıkar, " +
  "saat tek başına belirlemez, düşük öncelik elenmez, editoryal geçersiz kılma, sıralamasız iddia yok, " +
  "gerekçe zorunluluğu, turnuva ağırlıkları, bilinmeyen kulüp, istemci eşliği, ana sayfa denetimi)."
);
